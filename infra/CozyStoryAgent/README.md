# Cozy Mystery Bedrock AgentCore gateway

This project deploys an AgentCore Runtime that calls OpenAI gpt-oss-120b in the
runtime's AWS region using low reasoning effort, plus a Lambda Function URL
protected by a generated shared bearer secret.

The gateway accepts the PWA's JSON request (`messages`, `maxTokens`,
`temperature`, and optional `jsonSchema`) and returns `{ "text": "..." }`.
The PWA sends the bearer secret in the `Authorization` header. The secret is
generated in Secrets Manager and is never placed in the source tree.

## Deploy

Prerequisites: AWS credentials with AgentCore, CloudFormation, IAM, Lambda,
Secrets Manager, and Bedrock permissions; Node.js 22; and `uv`.

From the repository root, build and deploy in the configured AWS region:

```powershell
Set-Location infra\CozyStoryAgent
npm exec --yes --package=node@22 --package=@aws/agentcore -- agentcore deploy --region eu-central-1
```

The CDK stack outputs `GatewayUrl`, `GatewaySecretArn`, and `AgentRuntimeArn`.
Put the gateway URL into the PWA. Retrieve the bearer secret from Secrets
Manager using the secret ARN output:

```powershell
aws secretsmanager get-secret-value --secret-id <GatewaySecretArn> --query SecretString --output text --region eu-central-1
```

Do not commit or share the secret publicly. The PWA stores it in browser local
storage, which is not encrypted against users or software with access to that
browser profile.

## Remove deployed resources

Use the AgentCore CLI to remove the project stack and its resources:

```powershell
Set-Location infra\CozyStoryAgent
npm exec --yes --package=node@22 --package=@aws/agentcore -- agentcore remove --region eu-central-1
```

Model inference, AgentCore Runtime, Lambda, logs, and secret storage can incur
AWS charges. The gateway limits Lambda concurrency to two, but this is not a
hard spending cap.
