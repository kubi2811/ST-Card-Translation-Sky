/* ─── PNG Chara Extractor and Embedder ─── */

// Precompute CRC32 table
const makeCRCTable = () => {
    let c;
    const crcTable = [];
    for(let n = 0; n < 256; n++){
        c = n;
        for(let k = 0; k < 8; k++){
            c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c >>> 0;
    }
    return crcTable;
};
const crcTable = makeCRCTable();

const crc32 = (data: Uint8Array) => {
    let crc = 0 ^ (-1);
    for (let i = 0; i < data.length; i++ ) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
};

/** Extracts character JSON from a SillyTavern PNG card */
export const extractCharaFromPNG = async (file: File): Promise<{json: string, dataUrl: string}> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const buffer = reader.result as ArrayBuffer;
            const view = new DataView(buffer);
            const uint8 = new Uint8Array(buffer);
            
            // Check PNG signature
            const sig = [137, 80, 78, 71, 13, 10, 26, 10];
            for (let i=0; i<8; i++) {
                if (uint8[i] !== sig[i]) return reject(new Error("Not a valid PNG file"));
            }
            
            let offset = 8;
            const decoder = new TextDecoder('utf-8');
            let foundJson: string | null = null;
            
            while (offset < uint8.length) {
                const length = view.getUint32(offset);
                offset += 4;
                const typeBytes = uint8.slice(offset, offset + 4);
                const type = decoder.decode(typeBytes);
                offset += 4;
                
                if (type === 'tEXt' || type === 'iTXt') {
                    const dataBytes = uint8.slice(offset, offset + length);
                    // tEXt format: keyword + \0 + text
                    let nullIdx = dataBytes.indexOf(0);
                    if (nullIdx !== -1) {
                        const keyword = decoder.decode(dataBytes.slice(0, nullIdx));
                        if (keyword === 'chara') {
                            const textData = dataBytes.slice(nullIdx + 1);
                            const text = decoder.decode(textData);
                            // base64 decode to bytes, then utf-8 decode
                            const binStr = atob(text);
                            const bytes = new Uint8Array(binStr.length);
                            for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
                            foundJson = new TextDecoder('utf-8').decode(bytes);
                            break;
                        }
                    }
                }
                offset += length;
                offset += 4; // Skip CRC
            }

            if (!foundJson) {
                return reject(new Error("No SillyTavern 'chara' data found in PNG."));
            }

            // Create data URL of original image
            let binaryStr = '';
            // chunk to avoid stack overflow
            for (let i = 0; i < uint8.length; i += 8192) {
                binaryStr += String.fromCharCode.apply(null, Array.from(uint8.slice(i, i + 8192)));
            }
            const dataUrl = `data:image/png;base64,${btoa(binaryStr)}`;
            
            resolve({
                json: foundJson,
                dataUrl
            });
        };
        reader.readAsArrayBuffer(file);
    });
}

/** Embeds new character JSON back into the original PNG, returning a new Data URL */
export const embedCharaToPNG = async (originalDataUrl: string | ArrayBuffer, newJson: string): Promise<string> => {
    let uint8: Uint8Array;
    if (typeof originalDataUrl === 'string') {
        // 1. extract base64 from dataUrl
        const commaIdx = originalDataUrl.indexOf(',');
        if (commaIdx === -1) {
            throw new Error('Invalid PNG data URL: missing base64 payload (no comma separator)');
        }
        const b64 = originalDataUrl.slice(commaIdx + 1);
        const binStr = atob(b64);
        uint8 = new Uint8Array(binStr.length);
        for(let i=0; i<binStr.length; i++) uint8[i] = binStr.charCodeAt(i);
    } else {
        uint8 = new Uint8Array(originalDataUrl);
    }
    
    // 2. parse and rebuild
    const view = new DataView(uint8.buffer);
    const decoder = new TextDecoder('utf-8');
    
    const chunks: {type: string, data: Uint8Array}[] = [];
    let offset = 8;
    while (offset < uint8.length) {
        const length = view.getUint32(offset);
        offset += 4;
        const typeBytes = uint8.slice(offset, offset + 4);
        const type = decoder.decode(typeBytes);
        offset += 4;
        const dataBytes = uint8.slice(offset, offset + length);
        offset += length;
        offset += 4; // Skip CRC
        
        chunks.push({type, data: dataBytes});
    }
    
    // Remove existing chara and ccv3 chunks from any text type
    const filteredChunks = chunks.filter(c => {
        if (c.type !== 'tEXt' && c.type !== 'iTXt' && c.type !== 'zTXt') return true;
        const nullIdx = c.data.indexOf(0);
        if (nullIdx !== -1) {
            const kw = decoder.decode(c.data.slice(0, nullIdx));
            if (kw === 'chara' || kw === 'ccv3') return false;
        }
        return true;
    });
    
    // Create new chara chunk
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode('chara');
    
    // Safe base64 encode for utf8 json
    const utf8Json = encoder.encode(newJson);
    let binJson = '';
    for(let i=0; i<utf8Json.length; i += 8192) {
        binJson += String.fromCharCode.apply(null, Array.from(utf8Json.slice(i, i + 8192)));
    }
    const b64Json = btoa(binJson);
    const textBytes = encoder.encode(b64Json);
    
    const newChunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
    newChunkData.set(keywordBytes, 0);
    newChunkData[keywordBytes.length] = 0; // null separator
    newChunkData.set(textBytes, keywordBytes.length + 1);
    
    // Insert new chunk after IHDR (which is the first chunk)
    filteredChunks.splice(1, 0, { type: 'tEXt', data: newChunkData });
    
    // Rebuild PNG
    let totalSize = 8;
    for (const c of filteredChunks) {
        totalSize += 4 + 4 + c.data.length + 4;
    }
    
    const out = new Uint8Array(totalSize);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    out.set(sig, 0);
    let outOffset = 8;
    
    const outView = new DataView(out.buffer);
    
    for (const c of filteredChunks) {
        // length
        outView.setUint32(outOffset, c.data.length);
        outOffset += 4;
        
        const startCrc = outOffset;
        
        // type
        const typeBytes = encoder.encode(c.type);
        out.set(typeBytes, outOffset);
        outOffset += 4;
        
        // data
        out.set(c.data, outOffset);
        outOffset += c.data.length;
        
        // CRC
        const crcData = out.slice(startCrc, outOffset);
        const crcVal = crc32(crcData);
        outView.setUint32(outOffset, crcVal);
        outOffset += 4;
    }
    
    // Convert back to dataUrl
    let finalBin = '';
    for (let i = 0; i < out.length; i += 8192) {
        finalBin += String.fromCharCode.apply(null, Array.from(out.slice(i, i + 8192)));
    }
    return `data:image/png;base64,${btoa(finalBin)}`;
}
