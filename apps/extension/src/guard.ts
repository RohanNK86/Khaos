/**
 * Dry-run network guard with declarativeNetRequest SESSION rules.
 * One block rule per tab: every POST/PUT/PATCH/DELETE the tab makes (to its own origin or any other
 * host, any resource type including form navigations) is blocked. Session rules vanish when the browser
 * restarts, and we remove them when the run ends.
 *
 * Counting blocked requests: `onRuleMatchedDebug` gives a live log (unpacked extensions with the
 * declarativeNetRequestFeedback permission, which is how the demo extension is loaded). Packed installs
 * fall back to `getMatchedRules({ tabId })` after the run (count only, same permission).
 */

export const SEND_METHODS = ["post", "put", "patch", "delete"] as const;
const ALL_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest",
  "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other",
] as const;

export const guardRuleId = (tabId: number) => (tabId % 1_000_000_000) + 1;

export function guardRule(tabId: number): chrome.declarativeNetRequest.Rule {
  return {
    id: guardRuleId(tabId),
    priority: 1,
    action: { type: "block" as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      tabIds: [tabId],
      requestMethods: [...SEND_METHODS] as chrome.declarativeNetRequest.RequestMethod[],
      resourceTypes: [...ALL_TYPES] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
}

export interface BlockedRequest { method: string; url: string }

export interface Guard {
  arm(): Promise<void>;
  disarm(): Promise<void>;
  /** Blocked requests seen live (empty when the debug event is unavailable). */
  readonly log: BlockedRequest[];
  /** Live count when available, otherwise the matched-rules count. */
  count(): Promise<number>;
}

export function createGuard(tabId: number, onBlocked?: (b: BlockedRequest) => void): Guard {
  const dnr = chrome.declarativeNetRequest;
  const id = guardRuleId(tabId);
  const log: BlockedRequest[] = [];
  let armedAt = 0;
  const debug = dnr.onRuleMatchedDebug as typeof dnr.onRuleMatchedDebug | undefined;
  const listener = (info: chrome.declarativeNetRequest.MatchedRuleInfoDebug) => {
    if (info.rule.ruleId !== id || info.request.tabId !== tabId) return;
    const b = { method: info.request.method.toUpperCase(), url: info.request.url };
    log.push(b);
    onBlocked?.(b);
  };
  return {
    log,
    async arm() {
      armedAt = Date.now();
      await dnr.updateSessionRules({ removeRuleIds: [id], addRules: [guardRule(tabId)] });
      debug?.addListener(listener);
    },
    async disarm() {
      debug?.removeListener(listener);
      await dnr.updateSessionRules({ removeRuleIds: [id] });
    },
    async count() {
      if (debug) return log.length;
      const m = await dnr.getMatchedRules({ tabId, minTimeStamp: armedAt }).catch(() => ({ rulesMatchedInfo: [] }));
      return m.rulesMatchedInfo.filter((r) => r.rule.ruleId === id).length;
    },
  };
}
