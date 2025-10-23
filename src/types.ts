export interface DeploySpecHook {
  location: string;
  timeout?: number;
  runas?: string;
}

export interface DeploySpecPermission {
  object: string;
  pattern: string;
  owner?: string;
  group?: string;
  mode?: string | number;
  type?: string[];
}

export interface DeploySpec {
  version: string;
  hooks?: {
    ApplicationStop?: DeploySpecHook[];
    BeforeInstall?: DeploySpecHook[];
    AfterInstall?: DeploySpecHook[];
    ApplicationStart?: DeploySpecHook[];
    ValidateService?: DeploySpecHook[];
  };
  permissions?: DeploySpecPermission[];
}

export interface ActionInputs {
  host: string;
  port: number;
  user: string;
  password?: string;
  key?: string;
  deployspecPath: string;
  sourcePath: string;
  targetPath: string;
}