/** Service worker: open the side panel from the toolbar icon; clean up guard rules of closed tabs. */
import { guardRuleId } from "./guard.js";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [guardRuleId(tabId)] });
});
