const WIDTH_IN_BITS = 160;
const SHIFT = 11;
const BITS_IN_LAST_CELL = 32;

/**
 * QuickXorHash implementation conforming to Microsoft's documented algorithm
 * for OneDrive for Business and SharePoint Online.
 */
export class QuickXorHasher {
  private data: bigint[] = [0n, 0n, 0n];
  private lengthSoFar = 0n;
  private shiftSoFar = 0;

  public update(chunk: Uint8Array | Buffer): this {
    const cbSize = chunk.length;
    let vectorArrayIndex = Math.floor(this.shiftSoFar / 64);
    let vectorOffset = this.shiftSoFar % 64;

    const iterations = Math.min(cbSize, WIDTH_IN_BITS);

    for (let i = 0; i < iterations; i++) {
      const isLastCell = vectorArrayIndex === 2;
      const bitsInVectorCell = isLastCell ? BITS_IN_LAST_CELL : 64;

      if (vectorOffset <= bitsInVectorCell - 8) {
        for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
          const byteVal = BigInt(chunk[j] ?? 0);
          this.data[vectorArrayIndex] =
            (this.data[vectorArrayIndex] ?? 0n) ^ (byteVal << BigInt(vectorOffset));
        }
      } else {
        const index1 = vectorArrayIndex;
        const index2 = !isLastCell ? vectorArrayIndex + 1 : 0;
        const low = BigInt(bitsInVectorCell - vectorOffset);

        let xoredByte = 0;
        for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
          xoredByte ^= chunk[j] ?? 0;
        }
        const bVal = BigInt(xoredByte);
        this.data[index1] = (this.data[index1] ?? 0n) ^ (bVal << BigInt(vectorOffset));
        this.data[index2] = (this.data[index2] ?? 0n) ^ (bVal >> low);
      }

      vectorOffset += SHIFT;
      while (vectorOffset >= bitsInVectorCell) {
        vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
        vectorOffset -= bitsInVectorCell;
      }
    }

    this.shiftSoFar = (this.shiftSoFar + SHIFT * (cbSize % WIDTH_IN_BITS)) % WIDTH_IN_BITS;
    this.lengthSoFar += BigInt(cbSize);
    return this;
  }

  public digest(encoding: 'base64' | 'hex' = 'base64'): string {
    const buffer = Buffer.alloc(20);
    buffer.writeBigUInt64LE((this.data[0] ?? 0n) & 0xffffffffffffffffn, 0);
    buffer.writeBigUInt64LE((this.data[1] ?? 0n) & 0xffffffffffffffffn, 8);
    buffer.writeUInt32LE(Number((this.data[2] ?? 0n) & 0xffffffffn), 16);

    const lenBuf = Buffer.alloc(8);
    lenBuf.writeBigUInt64LE(this.lengthSoFar, 0);
    for (let i = 0; i < 8; i++) {
      buffer[12 + i] = (buffer[12 + i] ?? 0) ^ (lenBuf[i] ?? 0);
    }

    return buffer.toString(encoding);
  }
}

export function quickXorHash(
  data: Uint8Array | Buffer | string,
  encoding: 'base64' | 'hex' = 'base64'
): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return new QuickXorHasher().update(buf).digest(encoding);
}
