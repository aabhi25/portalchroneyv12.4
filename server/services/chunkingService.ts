/**
 * Text Chunking Service for RAG
 * Splits large text into smaller, overlapping chunks for semantic search
 */

export interface TextChunk {
  text: string;
  index: number;
}

export class ChunkingService {
  private readonly minChunkSize = 500;
  private readonly maxChunkSize = 1000;
  private readonly overlapSize = 100;

  /**
   * Split text into overlapping chunks
   * @param text - Full text to chunk
   * @returns Array of text chunks with metadata
   */
  chunkText(text: string): TextChunk[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Clean up text: normalize whitespace
    const cleanedText = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // If text is shorter than min chunk size, return as single chunk
    if (cleanedText.length <= this.minChunkSize) {
      return [{ text: cleanedText, index: 0 }];
    }

    const chunks: TextChunk[] = [];
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < cleanedText.length) {
      // Determine end index for this chunk
      let endIndex = Math.min(startIndex + this.maxChunkSize, cleanedText.length);

      // If not at the end of text, try to find a good breaking point
      if (endIndex < cleanedText.length) {
        endIndex = this.findBreakPoint(cleanedText, startIndex, endIndex);
      }

      // Extract chunk text
      const chunkText = cleanedText.slice(startIndex, endIndex).trim();

      // Only add non-empty chunks
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          index: chunkIndex++,
        });
      }

      // Move to next chunk with overlap
      // If we're near the end and overlap would create tiny chunk, just finish
      const nextStart = endIndex - this.overlapSize;
      if (cleanedText.length - nextStart < this.minChunkSize / 2) {
        break;
      }

      startIndex = Math.max(startIndex + 1, nextStart);
    }

    return chunks;
  }

  /**
   * Find the best breaking point for a chunk
   * Prefers: paragraph > sentence > word boundary
   */
  private findBreakPoint(text: string, start: number, maxEnd: number): number {
    // Search window: look back up to 200 chars for a good break point
    const searchStart = Math.max(start, maxEnd - 200);
    const searchText = text.slice(searchStart, maxEnd);

    // Try to find paragraph break (double newline)
    const paragraphBreak = searchText.lastIndexOf('\n\n');
    if (paragraphBreak !== -1 && paragraphBreak > searchText.length / 2) {
      return searchStart + paragraphBreak + 2; // +2 to skip the newlines
    }

    // Try to find sentence break
    const sentenceBreak = this.findSentenceBreak(searchText);
    if (sentenceBreak !== -1 && sentenceBreak > searchText.length / 2) {
      return searchStart + sentenceBreak;
    }

    // Try to find word boundary (space)
    const wordBreak = searchText.lastIndexOf(' ');
    if (wordBreak !== -1 && wordBreak > searchText.length / 2) {
      return searchStart + wordBreak + 1; // +1 to skip the space
    }

    // If no good break found, use max end
    return maxEnd;
  }

  /**
   * Find the last sentence boundary in text
   * Looks for: . ! ? followed by space or newline
   */
  private findSentenceBreak(text: string): number {
    const sentenceEnders = /[.!?][\s\n]/g;
    let lastMatch = -1;
    let match;

    while ((match = sentenceEnders.exec(text)) !== null) {
      lastMatch = match.index + 1; // +1 to include the punctuation
    }

    return lastMatch;
  }

  /**
   * Estimate token count for a chunk (rough approximation)
   * 1 token ≈ 4 characters for English text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const chunkingService = new ChunkingService();
