import * as core from '@actions/core';
import { NodeSSH } from 'node-ssh';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execSync } from 'child_process';
import { DeploySpec, DeploySpecHook, ActionInputs } from './types';

class SSHDeployer {
  private ssh: NodeSSH;
  private inputs: ActionInputs;
  private deploySpec: DeploySpec;

  constructor() {
    this.ssh = new NodeSSH();
    this.inputs = this.getInputs();
    this.deploySpec = { version: '1.0' };
  }

  private getInputs(): ActionInputs {
    return {
      host: core.getInput('host', { required: true }),
      port: parseInt(core.getInput('port') || '22'),
      user: core.getInput('user', { required: true }),
      password: core.getInput('password'),
      key: core.getInput('key'),
      deployspecPath: core.getInput('deployspec_path') || 'deployspec.yml',
      sourcePath: core.getInput('source_path') || '.',
      targetPath: core.getInput('target_path', { required: true })
    };
  }

  private async connect(): Promise<void> {
    core.info(`Connecting to ${this.inputs.host}:${this.inputs.port}...`);

    const config: any = {
      host: this.inputs.host,
      port: this.inputs.port,
      username: this.inputs.user
    };

    if (this.inputs.key) {
      config.privateKey = this.inputs.key;
    } else if (this.inputs.password) {
      config.password = this.inputs.password;
    } else {
      throw new Error('Either password or key must be provided');
    }

    await this.ssh.connect(config);
    core.info('Connected successfully');
  }

  private loadDeploySpec(): void {
    const deployspecFullPath = path.join(process.cwd(), this.inputs.deployspecPath);

    if (!fs.existsSync(deployspecFullPath)) {
      core.warning(`deployspec file not found at ${deployspecFullPath}, skipping hooks`);
      return;
    }

    const content = fs.readFileSync(deployspecFullPath, 'utf8');
    this.deploySpec = yaml.load(content) as DeploySpec;
    core.info('Loaded deployspec.yml');
  }

  private async executeHooks(hookName: keyof NonNullable<DeploySpec['hooks']>): Promise<void> {
    const hooks = this.deploySpec.hooks?.[hookName];
    if (!hooks || hooks.length === 0) {
      core.info(`No hooks defined for ${hookName}`);
      return;
    }

    core.info(`Executing ${hookName} hooks...`);

    for (const hook of hooks) {
      await this.executeHook(hook, hookName);
    }
  }

  private async executeHook(hook: DeploySpecHook, hookName: string): Promise<void> {
    const scriptPath = path.join(this.inputs.targetPath, hook.location);
    const timeout = hook.timeout || 300;
    const runas = hook.runas || this.inputs.user;

    core.info(`Running ${hook.location} (timeout: ${timeout}s, runas: ${runas})`);

    try {
      const command = runas !== this.inputs.user
        ? `sudo -u ${runas} bash ${scriptPath}`
        : `bash ${scriptPath}`;

      const result = await this.ssh.execCommand(command, {
        cwd: this.inputs.targetPath
      });

      if (result.code !== 0) {
        throw new Error(`Hook failed with exit code ${result.code}\nStderr: ${result.stderr}\nStdout: ${result.stdout}`);
      }

      core.info(`✓ ${hook.location} completed successfully`);
      if (result.stdout) {
        core.info(`Output: ${result.stdout}`);
      }
    } catch (error) {
      core.error(`✗ ${hook.location} failed: ${error}`);
      throw error;
    }
  }

  private async uploadFiles(): Promise<void> {
    const timestamp = Date.now();
    const archiveName = `deploy-${timestamp}.tar.gz`;
    const localArchivePath = path.join('/tmp', archiveName);
    const remoteArchivePath = `/tmp/${archiveName}`;

    try {
      // Create tar.gz archive locally
      core.info(`Creating archive from ${this.inputs.sourcePath}...`);

      const excludePatterns = [
        '--exclude=.git',
        '--exclude=node_modules',
        '--exclude=.env',
        '--exclude=*.log'
      ].join(' ');

      execSync(
        `tar -czf ${localArchivePath} ${excludePatterns} -C ${this.inputs.sourcePath} .`,
        { stdio: 'inherit' }
      );

      const stats = fs.statSync(localArchivePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      core.info(`✓ Archive created: ${sizeMB} MB`);

      // Upload archive to remote server
      core.info(`Uploading archive to ${this.inputs.host}...`);
      await this.ssh.putFile(localArchivePath, remoteArchivePath);
      core.info('✓ Archive uploaded');

      // Create target directory and extract archive
      core.info(`Extracting archive to ${this.inputs.targetPath}...`);
      await this.ssh.execCommand(`mkdir -p ${this.inputs.targetPath}`);

      const extractResult = await this.ssh.execCommand(
        `tar -xzf ${remoteArchivePath} -C ${this.inputs.targetPath}`
      );

      if (extractResult.code !== 0) {
        throw new Error(`Failed to extract archive: ${extractResult.stderr}`);
      }

      core.info('✓ Archive extracted successfully');

      // Cleanup remote archive
      await this.ssh.execCommand(`rm -f ${remoteArchivePath}`);
      core.info('✓ Deployment files transferred');

    } finally {
      // Cleanup local archive
      if (fs.existsSync(localArchivePath)) {
        fs.unlinkSync(localArchivePath);
      }
    }
  }

  private async setPermissions(): Promise<void> {
    const permissions = this.deploySpec.permissions;
    if (!permissions || permissions.length === 0) {
      core.info('No permissions to set');
      return;
    }

    core.info('Setting file permissions...');

    for (const perm of permissions) {
      const targetDir = path.join(this.inputs.targetPath, perm.object);

      if (perm.mode) {
        const modeStr = typeof perm.mode === 'number' ? perm.mode.toString(8) : perm.mode;
        await this.ssh.execCommand(`find ${targetDir} -name "${perm.pattern}" -type f -exec chmod ${modeStr} {} \\;`);
      }

      if (perm.owner && perm.group) {
        await this.ssh.execCommand(`find ${targetDir} -name "${perm.pattern}" -type f -exec chown ${perm.owner}:${perm.group} {} \\;`);
      }
    }

    core.info('✓ Permissions set successfully');
  }

  async deploy(): Promise<void> {
    try {
      await this.connect();
      this.loadDeploySpec();

      // Deployment lifecycle
      await this.executeHooks('ApplicationStop');
      await this.executeHooks('BeforeInstall');
      await this.uploadFiles();
      await this.setPermissions();
      await this.executeHooks('AfterInstall');
      await this.executeHooks('ApplicationStart');
      await this.executeHooks('ValidateService');

      core.info('✓ Deployment completed successfully');
    } catch (error) {
      core.setFailed(`Deployment failed: ${error}`);
      throw error;
    } finally {
      this.ssh.dispose();
    }
  }
}

async function run(): Promise<void> {
  const deployer = new SSHDeployer();
  await deployer.deploy();
}

run();