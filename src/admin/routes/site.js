import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const ecs = new ECSClient({});

const {
  ECS_CLUSTER,
  ECS_TASK_DEF,
  ECS_SUBNETS,
  ECS_SECURITY_GROUP,
  ECS_CONTAINER_NAME,
  SITE_DISTRO_URL,
} = process.env;

export async function rebuild() {
  if (!ECS_CLUSTER || !ECS_TASK_DEF || !ECS_SUBNETS || !ECS_SECURITY_GROUP) {
    return { statusCode: 500, body: { error: 'Site rebuild infrastructure not configured.' } };
  }

  const subnets = ECS_SUBNETS.split(',').map(s => s.trim());

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
      }],
    },
  }));

  if (failures?.length > 0) {
    return { statusCode: 500, body: { error: `Failed to start task: ${failures[0].reason}` } };
  }

  const taskArn = tasks?.[0]?.taskArn;
  if (!taskArn) {
    return { statusCode: 500, body: { error: 'Failed to start rebuild task.' } };
  }

  return {
    statusCode: 202,
    body: {
      status: 'started',
      taskId: taskArn.split('/').pop(),
      taskArn,
      siteUrl: SITE_DISTRO_URL || null,
    },
  };
}

export async function status({ params }) {
  const [taskId] = params;

  if (!ECS_CLUSTER) {
    return { statusCode: 500, body: { error: 'ECS cluster not configured.' } };
  }

  const { tasks } = await ecs.send(new DescribeTasksCommand({
    cluster: ECS_CLUSTER,
    tasks: [taskId],
  }));

  const task = tasks?.[0];
  if (!task) {
    return { statusCode: 404, body: { error: 'Task not found.' } };
  }

  const container = task.containers?.[0];
  const exitCode = container?.exitCode;

  let phase;
  if (task.lastStatus === 'STOPPED') {
    phase = exitCode === 0 ? 'succeeded' : 'failed';
  } else {
    phase = 'running';
  }

  return {
    body: {
      taskId,
      phase,
      lastStatus: task.lastStatus,
      exitCode: exitCode ?? null,
      reason: container?.reason || task.stoppedReason || null,
      siteUrl: SITE_DISTRO_URL || null,
      createdAt: task.createdAt?.toISOString() || null,
      stoppedAt: task.stoppedAt?.toISOString() || null,
    },
  };
}

export function info() {
  return {
    body: {
      siteUrl: SITE_DISTRO_URL || null,
      configured: !!(ECS_CLUSTER && ECS_TASK_DEF),
    },
  };
}
