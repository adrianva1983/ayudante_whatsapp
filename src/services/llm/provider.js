/**
 * @typedef {{ role: "system"|"user"|"assistant", content: string }} ChatMessage
 */

/**
 * @interface
 */
export class LLMProvider {
  /**
   * @param {ChatMessage[]} _messages
   * @returns {Promise<string>}
   */
  async generateReply(_messages) {
    throw new Error("generateReply must be implemented");
  }

  /** @returns {string} current model identifier */
  getModel() {
    throw new Error("getModel must be implemented");
  }

  /** @param {string} _model new model identifier */
  setModel(_model) {
    throw new Error("setModel must be implemented");
  }
}
