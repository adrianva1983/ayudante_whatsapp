/**
 * @typedef {"system"|"user"|"assistant"} ChatRole
 */

/**
 * @typedef {Object} ChatMessage
 * @property {ChatRole} role
 * @property {string} content
 */

export const CHAT_ROLES = ["system", "user", "assistant"];
