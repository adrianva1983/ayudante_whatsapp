/**
 * @typedef {{ role: "system"|"user"|"assistant", content: string|Array }} ChatMessage
 * @typedef {{ type: "image"|"audio", mimeType: string, buffer: Buffer }} MediaAttachment
 */

/**
 * @interface
 */
export class LLMProvider {
  /**
   * @param {ChatMessage[]} _messages
   * @param {MediaAttachment|null} _attachment  Optional image or audio
   * @returns {Promise<string>}
   */
  async generateReply(_messages, _attachment = null) {
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

  /** @returns {boolean} whether this provider supports image attachments */
  supportsVision() {
    return false;
  }

  /** @returns {boolean} whether this provider supports audio attachments */
  supportsAudio() {
    return false;
  }
}
