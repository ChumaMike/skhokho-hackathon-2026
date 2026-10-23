/**
 * Which workflows a business can run right now — capability AND plan — for
 * callers that have a business row but not the plan (site.ts, the lead API,
 * the Customer actions page). The plan is only looked up when at least one
 * workflow capability is switched on, so businesses without workflows pay
 * nothing for this.
 */

import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { hasFeature } from '@/modules/billing/entitlements'
import type { BusinessCapability } from '@/modules/tenant/capabilities'
import { activeWorkflows, WORKFLOWS_FEATURE, type WorkflowId } from './workflows'

export async function activeWorkflowsFor(businessId: string, capabilities: Set<BusinessCapability>): Promise<WorkflowId[]> {
  if (activeWorkflows(capabilities, true).length === 0) return []
  const entitlements = await getBusinessEntitlements(businessId)
  return activeWorkflows(capabilities, hasFeature(entitlements, WORKFLOWS_FEATURE))
}

/** Whether the plan includes workflows at all (for the Customer actions page's upgrade note). */
export async function workflowsInPlan(businessId: string): Promise<boolean> {
  return hasFeature(await getBusinessEntitlements(businessId), WORKFLOWS_FEATURE)
}
