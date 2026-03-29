import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({});
let cached = null;

async function getCredentials() {
  if (cached) return cached;
  const { SecretString } = await sm.send(new GetSecretValueCommand({
    SecretId: process.env.ADMIN_SECRET_ARN,
  }));
  cached = JSON.parse(SecretString);
  return cached;
}

export async function checkAuth(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  if (!header.startsWith('Basic ')) return false;

  const decoded = Buffer.from(header.slice(6), 'base64').toString();
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;

  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  const creds = await getCredentials();

  return user === creds.username && pass === creds.password;
}

export const UNAUTHORIZED = {
  statusCode: 401,
  headers: {
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Basic realm="Memory MCP Admin"',
  },
  body: JSON.stringify({ error: 'Unauthorized' }),
};
