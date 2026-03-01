import { feishuIntegration } from '../../integrations/feishu/index.js';
import { localIntegration } from '../../integrations/local/index.js';
import type { Integration, IntegrationId } from '../../integrations/contracts.js';

export const integrationRegistry: Record<IntegrationId, Integration> = {
  feishu: feishuIntegration,
  local: localIntegration,
};

export const integrationIds = Object.keys(integrationRegistry) as IntegrationId[];
