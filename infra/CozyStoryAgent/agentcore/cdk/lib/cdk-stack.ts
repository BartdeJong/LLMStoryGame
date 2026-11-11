import { AgentCoreApplication, type AgentCoreApplicationProps } from '@aws/agentcore-cdk';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'node:path';

export interface AgentCoreStackProps extends StackProps {
  /** Props for the AgentCore application, produced by transformAgentCoreJson from agentcore/agentcore.json. */
  application: AgentCoreApplicationProps;
}

/**
 * The stack the AgentCore CLI deploys. Everything declared in agentcore/agentcore.json is
 * created by the AgentCoreApplication construct. Add your own resources below it and wire
 * them to your runtimes and harnesses through the application's accessors.
 */
export class AgentCoreStack extends Stack {
  public readonly application: AgentCoreApplication;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);
    this.application = new AgentCoreApplication(this, 'Application', props.application);

    const agent = this.application.runtime('agent');
    const modelId = 'openai.gpt-oss-20b-1:0';
    agent.addEnvironmentVariable('BEDROCK_MODEL_ID', modelId);
    agent.addToPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:${Stack.of(this).partition}:bedrock:${Stack.of(this).region}::foundation-model/${modelId}`,
      ],
    }));

    const accessSecret = new secretsmanager.Secret(this, 'GatewayAccessSecret', {
      description: 'Shared bearer secret for the Cozy Mystery Bedrock gateway.',
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
      },
    });
    const gateway = new lambdaNodejs.NodejsFunction(this, 'BedrockGateway', {
      entry: path.resolve(__dirname, '../../lib/gateway/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      reservedConcurrentExecutions: 2,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: { minify: true, sourceMap: false },
      environment: {
        AGENT_RUNTIME_ARN: agent.runtimeArn,
        ACCESS_SECRET_ARN: accessSecret.secretArn,
      },
    });
    accessSecret.grantRead(gateway);
    agent.grantInvoke(gateway);

    const gatewayUrl = gateway.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    });

    new CfnOutput(this, 'GatewayUrl', { value: gatewayUrl.url });
    new CfnOutput(this, 'GatewaySecretArn', { value: accessSecret.secretArn });
    new CfnOutput(this, 'AgentRuntimeArn', { value: agent.runtimeArn });
  }
}
