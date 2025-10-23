# SSH Remote Deploy Action

SSH를 통해 원격 서버에 배포하는 GitHub Action입니다. AWS CodeDeploy와 유사한 방식으로 배포 생명주기 훅을 지원합니다.

## 기능

- SSH를 통한 안전한 파일 전송
- 배포 생명주기 훅 (ApplicationStop, BeforeInstall, AfterInstall, ApplicationStart, ValidateService)
- 파일 권한 자동 설정
- 비밀번호 또는 SSH 키 인증 지원

## 사용법

### 기본 예제

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to server
        uses: snowykte0426/gsm-sv-deploy@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          user: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          target_path: /var/www/myapp
          deployspec_path: deployspec.yml
```

### SSH 키 사용

```yaml
- name: Deploy with SSH key
  uses: snowykte0426/gsm-sv-deploy@v1
  with:
    host: example.com
    port: 22
    user: ubuntu
    key: ${{ secrets.SSH_KEY }}
    target_path: /home/ubuntu/app
```

### 비밀번호 사용

```yaml
- name: Deploy with password
  uses: snowykte0426/gsm-sv-deploy@v1
  with:
    host: example.com
    user: root
    password: ${{ secrets.SSH_PASSWORD }}
    target_path: /opt/myapp
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | Yes | - | 원격 서버 호스트명 또는 IP |
| `port` | No | `22` | SSH 포트 |
| `user` | Yes | - | SSH 사용자명 |
| `password` | No | - | SSH 비밀번호 (password 또는 key 중 하나 필수) |
| `key` | No | - | SSH 개인키 (password 또는 key 중 하나 필수) |
| `deployspec_path` | No | `deployspec.yml` | deployspec 파일 경로 |
| `source_path` | No | `.` | 배포할 소스 디렉토리 |
| `target_path` | Yes | - | 원격 서버의 배포 대상 경로 |

## deployspec.yml

배포 생명주기를 정의하는 파일입니다.

```yaml
version: 1.0

hooks:
  # 애플리케이션 중지
  ApplicationStop:
    - location: scripts/stop_application.sh
      timeout: 300
      runas: root

  # 파일 복사 전 실행
  BeforeInstall:
    - location: scripts/before_install.sh
      timeout: 300
      runas: root

  # 파일 복사 후 실행
  AfterInstall:
    - location: scripts/after_install.sh
      timeout: 300
      runas: root
    - location: scripts/setup_permissions.sh
      timeout: 60
      runas: root

  # 애플리케이션 시작
  ApplicationStart:
    - location: scripts/start_application.sh
      timeout: 300
      runas: root

  # 배포 검증
  ValidateService:
    - location: scripts/validate_service.sh
      timeout: 300
      runas: root

# 파일 권한 설정
permissions:
  - object: /
    pattern: "**"
    owner: root
    group: root
    mode: 644
    type:
      - file
  - object: /scripts
    pattern: "*.sh"
    owner: root
    group: root
    mode: 755
    type:
      - file
```

### 배포 생명주기

1. **ApplicationStop**: 기존 애플리케이션을 중지합니다
2. **BeforeInstall**: 파일을 복사하기 전에 실행됩니다 (의존성 설치, 백업 등)
3. **파일 전송**: 소스 파일을 원격 서버로 복사합니다
4. **권한 설정**: deployspec에 정의된 파일 권한을 설정합니다
5. **AfterInstall**: 파일 복사 후 실행됩니다 (설정 파일 생성, 빌드 등)
6. **ApplicationStart**: 애플리케이션을 시작합니다
7. **ValidateService**: 배포가 성공적으로 완료되었는지 검증합니다

### Hook 옵션

- `location`: 실행할 스크립트의 경로 (target_path 기준 상대 경로)
- `timeout`: 스크립트 실행 제한 시간 (초, 기본값: 300)
- `runas`: 스크립트를 실행할 사용자 (기본값: SSH 접속 사용자)

## 스크립트 예제

### scripts/stop_application.sh
```bash
#!/bin/bash
systemctl stop myapp || true
```

### scripts/start_application.sh
```bash
#!/bin/bash
systemctl start myapp
```

### scripts/validate_service.sh
```bash
#!/bin/bash
curl -f http://localhost:3000/health || exit 1
```

## 개발

```bash
# 의존성 설치
npm install

# 빌드
npm run build

# 테스트
npm test
```

## License

MIT