import fs from 'fs';

const buffer = fs.readFileSync('e:\\d-ch-card-sillytarven\\fb9f6bb22ba6dc7b.png');
let offset = 8;
let foundJson = null;

while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.toString('utf8', offset, offset + 4);
    offset += 4;
    
    if (type === 'tEXt' || type === 'iTXt') {
        const dataBytes = buffer.subarray(offset, offset + length);
        let nullIdx = dataBytes.indexOf(0);
        if (nullIdx !== -1) {
            const keyword = dataBytes.toString('utf8', 0, nullIdx);
            if (keyword === 'chara') {
                const textData = dataBytes.toString('utf8', nullIdx + 1);
                foundJson = Buffer.from(textData, 'base64').toString('utf8');
                break;
            }
        }
    }
    offset += length;
    offset += 4; // Skip CRC
}

if (foundJson) {
    const chara = JSON.parse(foundJson);
    console.log("Card Name:", chara.name || chara.data?.name);
    const regexScripts = chara.data?.extensions?.regex_scripts || [];
    console.log(`Found ${regexScripts.length} regex scripts.`);
    regexScripts.forEach((s, i) => {
        console.log(`\nScript ${i}: ${s.scriptName}`);
        if (s.replaceString) {
            console.log(`replaceString length: ${s.replaceString.length}`);
        }
        if (s.trimStrings) {
            console.log(`trimStrings count: ${s.trimStrings.length}`);
            s.trimStrings.forEach((ts, j) => {
                console.log(`  trimStrings[${j}] length: ${ts.length}`);
            });
        }
    });
    fs.writeFileSync('e:\\d-ch-card-sillytarven\\scratch_card_data.json', JSON.stringify(chara, null, 2));
    console.log("Saved full JSON to scratch_card_data.json");
} else {
    console.log("No chara data found.");
}
