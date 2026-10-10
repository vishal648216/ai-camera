/**
 * Abstract FaceSwapProvider interface.
 * Decouples the frontend and API routes from the underlying AI model implementation.
 */
class FaceSwapProvider {
  /**
   * Performs face swap onto a master template.
   * @param {Object} options
   * @param {string} options.sourcePath - Path to background-removed or original user selfie
   * @param {string} options.targetPath - Path to real fixed master template image
   * @param {string} options.outputPath - Destination path for final blended result
   * @param {Object} [options.faceRegion] - Target face metadata { x, y, width, height, rotation, scale }
   * @returns {Promise<{ success: boolean, outputPath: string, provider: string }>}
   */
  async swapFace({ sourcePath, targetPath, outputPath, faceRegion }) {
    throw new Error("swapFace() must be implemented by subclass.");
  }
}

module.exports = FaceSwapProvider;
