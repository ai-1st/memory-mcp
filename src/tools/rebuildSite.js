import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { getSelfUrl } from '../lib/selfUrl.js';

const ecs = new ECSClient({});

const {
  ECS_CLUSTER,
  ECS_TASK_DEF,
  ECS_SUBNETS,
  ECS_SECURITY_GROUP,
  ECS_CONTAINER_NAME,
  SITE_DISTRO_URL,
} = process.env;

export const rebuildSite = {
  name: 'rebuild_site',
  description: 'Trigger a Hugo site rebuild via Fargate. Exports all projects, builds Hugo, publishes to S3/CloudFront.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(_args, config) {
    if (!ECS_CLUSTER || !ECS_TASK_DEF || !ECS_SUBNETS || !ECS_SECURITY_GROUP) {
      return {
        content: [{ type: 'text', text: 'Site rebuild infrastructure not configured.' }],
        isError: true,
      };
    }

    const subnets = ECS_SUBNETS.split(',').map(s => s.trim());

    const mcpUrl = getSelfUrl();

    const { tasks, failures } = await ecs.send(new RunTaskCommand({
      cluster: ECS_CLUSTER,
      taskDefinition: ECS_TASK_DEF,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets,
          securityGroups: [ECS_SECURITY_GROUP],
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: ECS_CONTAINER_NAME || 'hugo-builder',
          environment: [{
            name: 'MCP_URL',
            value: mcpUrl,
          }],
        }],
      },
    }));

    if (failures?.length > 0) {
      return {
        content: [{ type: 'text', text: `Failed to start task: ${failures[0].reason}` }],
        isError: true,
      };
    }

    const taskArn = tasks?.[0]?.taskArn;
    if (!taskArn) {
      return {
        content: [{ type: 'text', text: 'Failed to start rebuild task.' }],
        isError: true,
      };
    }

    const taskId = taskArn.split('/').pop();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'started',
          taskId,
          taskArn,
          siteUrl: SITE_DISTRO_URL || null,
          message: 'Hugo site rebuild started. The task typically takes 1-2 minutes.',
        }, null, 2),
      }],
      isError: false,
    };
  },
};
