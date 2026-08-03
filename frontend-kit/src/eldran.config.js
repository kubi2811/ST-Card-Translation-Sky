/**
 * Bộ chuyển thể cho card "Hành Tinh Eldran" (bug 192).
 * ─────────────────────────────────────────────────────────────────────────────
 * ĐÂY LÀ FILE DUY NHẤT DÍNH TỚI CARD. runtime.js / opening.js / main.js đều dùng
 * chung cho mọi card; muốn port cơ chế sang card khác thì chỉ viết lại file này.
 *
 * Mọi đường dẫn biến bên dưới lấy ĐÚNG từ schema mvu_zod có sẵn trong card
 * (extensions.tavern_helper.scripts → "Cấu trúc biến Eldran Game Master"),
 * không bịa thêm trường nào.
 */
window.STFE_CONFIG = {
  id: 'eldran',
  title: 'Hành Tinh Eldran',
  subtitle: 'Năm 3000 SC · Kỷ nguyên Veil',

  /* Thẻ cập nhật biến THẬT của card này — không phải thẻ của card mẫu. */
  updateTag: 'UpdateVariable',
  /* Thẻ đánh dấu màn khởi tạo, đặt trong first_mes. */
  bootTag: 'EldranBoot',

  historyTurns: 14,
  maxStoredTurns: 400,
  maxSnapshots: 6,

  theme: {
    '--fe-accent': '#4dd6c1',
    '--fe-accent-2': '#7aa2ff',
    '--fe-bg': '#0a1119',
    '--fe-bg-soft': '#0f1b28',
    '--fe-panel': '#13202f',
    '--fe-panel-2': '#182b3f',
    '--fe-line': '#26405c',
  },

  /**
   * Bộ biến mặc định — chép ĐÚNG entry `[initvar]初始化` (#39) của chính thẻ này.
   *
   * Vì sao phải có: đo trên SillyTavern thật, lúc mở thẻ ra thì biến của lầu 0 vẫn rỗng
   * `{}` — MVU chưa chạy khởi tạo initvar (nó chờ sự kiện tin nhắn, mà lầu mở màn thì
   * chưa có sự kiện nào). Nếu màn khởi tạo cứ thế ghi hồ sơ lên một object rỗng thì
   * `Kho Đồ`, `Kỹ Năng`, `Mối Quan Hệ`, `Containers` sẽ KHÔNG TỒN TẠI, và lệnh
   * `insert /Kho Đồ/-` của AI ở ngay lượt sau sẽ trượt — mất sạch vật phẩm khởi đầu
   * mà chẳng báo lỗi gì. Nên giao diện tự cầm bộ mặc định, không phụ thuộc lúc MVU tỉnh.
   */
  defaultStat: {
    'Thế Giới': { 'Ngày': 1, 'Tháng': 1, 'Năm': 3000, 'Giờ': 8, 'Phút': 0,
      'Khu Vực': 'Trung - Đồng Bằng Cộng Hưởng', 'Bối Cảnh': '' },
    'Nhân Vật': {
      'Tên': 'Vô Danh', 'Tuổi': 18, 'Avatar': '', 'Phả Hệ': 'Ignis',
      'Phả Hệ Lai 1': '', 'Phả Hệ Lai 2': '', 'Veil-Tech': 'Không', 'Veil-Tech Style': '',
      'Thiên Phú': 'Ưu Tư', 'Cảnh Giới': 'Sơ thức', 'Tầng': 1, 'Cấp Hiệu Trấn Minh': 'Chưa có',
      'VP': { 'Hiện Tại': 100, 'Tối Đa': 100 },
    },
    'Tài Sản': { 'Veil Coin': 0, 'Điểm Công Trấn': 0, 'Veil Essence': 0 },
    'Containers': [{ 'Tên': 'Balo', 'Loại': 'Balo', 'Dung Tích': 'trung bình', 'Vị Trí': 'Trên người' }],
    'Kho Đồ': [],
    'Mối Quan Hệ': [],
    'Kỹ Năng': [],
  },

  /* ── các bảng giá trị lấy từ enum trong schema ───────────────────────── */
  enums: {
    phaHe: ['Ignis', 'Glacis', 'Virens', 'Fulmen', 'Umbra', 'Ferrum', 'Anima',
      'Psyche', 'Lumen', 'Aether', 'Chronos', 'Rift', 'Shard Lai', 'Null'],
    thienPhu: ['Phàm Tư', 'Lương Tư', 'Ưu Tư', 'Kỳ Tài', 'Dị Bẩm'],
    canhGioi: ['Không', 'Sơ thức', 'Thông mạch', 'Ngưng ảnh', 'Cộng hưởng', 'Dung thức',
      'Tinh thể', 'Phá giới', 'Siêu thức', 'Cận thần', 'Vĩnh hằng'],
    capHieu: ['Chưa có', 'F', 'E', 'D', 'C', 'B', 'A', 'S'],
    khuVuc: [
      'Trung - Đồng Bằng Cộng Hưởng', 'Luminaris', 'Pyrhaven', 'Frosthold', 'Thornspire',
      'Auren Sea', 'Stormreach', 'Tideglass', 'Skyarch Cluster', 'Aether Spire',
      'Ferrum Foundries', 'Rift Scarlands', 'Lumen Sanctum', 'Anima Veilgrove',
      'Psyche Athenaeum', 'Nulltech District', 'Chronos Observatory',
    ],
  },

  /* ── biểu mẫu màn khởi tạo ───────────────────────────────────────────── */
  form: [
    { key: 'ten', label: 'Tên nhân vật', type: 'text', path: 'Nhân Vật.Tên', value: '', placeholder: 'VD: Kael Verrin' },
    { key: 'tuoi', label: 'Tuổi', type: 'number', path: 'Nhân Vật.Tuổi', value: 18, min: 14, max: 80 },
    { key: 'phahe', label: 'Phả Hệ', type: 'select', path: 'Nhân Vật.Phả Hệ', from: 'phaHe', value: 'Ignis',
      hint: 'Chọn "Shard Lai" nếu muốn đa hệ, chọn "Null" nếu muốn đi đường Veil-Tech thuần.' },
    { key: 'lai1', label: 'Phả Hệ Lai 1', type: 'select', path: 'Nhân Vật.Phả Hệ Lai 1', from: 'phaHe', value: '',
      allowEmpty: true, showIf: { key: 'phahe', equals: 'Shard Lai' } },
    { key: 'lai2', label: 'Phả Hệ Lai 2', type: 'select', path: 'Nhân Vật.Phả Hệ Lai 2', from: 'phaHe', value: '',
      allowEmpty: true, showIf: { key: 'phahe', equals: 'Shard Lai' } },
    { key: 'thienphu', label: 'Thiên Phú', type: 'select', path: 'Nhân Vật.Thiên Phú', from: 'thienPhu', value: 'Ưu Tư',
      hint: 'Thiên phú càng cao thì VP tối đa khởi điểm càng lớn.' },
    { key: 'canhgioi', label: 'Cảnh Giới khởi đầu', type: 'select', path: 'Nhân Vật.Cảnh Giới', from: 'canhGioi', value: 'Sơ thức' },
    { key: 'veiltech', label: 'Veil-Tech', type: 'text', path: 'Nhân Vật.Veil-Tech', value: 'Không',
      placeholder: 'Không / Giáp Ferrum cấp 1 / Kính Chronos...' },
    { key: 'vtstyle', label: 'Phong cách Veil-Tech', type: 'text', path: 'Nhân Vật.Veil-Tech Style', value: '',
      placeholder: 'Cận chiến nặng, trinh sát, hỗ trợ...' },
    { key: 'khuvuc', label: 'Khu vực khởi đầu', type: 'select', path: 'Thế Giới.Khu Vực', from: 'khuVuc',
      value: 'Trung - Đồng Bằng Cộng Hưởng' },
  ],

  /* Bối cảnh mở màn — người chơi chọn 1. */
  scenarios: [
    { id: 'hocvien', title: 'Ngày nhập học Học Viện Veil',
      desc: 'Bắt đầu ở cổng học viện, giữa đám tân sinh đang chờ đo Cộng Hưởng Vị. An toàn, nhiều NPC.',
      seed: 'Nhân vật vừa tới Học Viện Veil trong ngày kiểm định Cộng Hưởng Vị đầu khoá.' },
    { id: 'thosan', title: 'Hợp đồng thợ săn đầu tiên',
      desc: 'Nhận tấm thẻ Trấn Minh hạng F và một hợp đồng dọn Rift nhỏ ở vành đai. Nguy hiểm vừa.',
      seed: 'Nhân vật vừa nhận hợp đồng thợ săn Trấn Minh hạng F đầu tiên, dọn một vết Rift nhỏ ở vành đai khu vực.' },
    { id: 'muarift', title: 'Đêm trước Mùa Rift',
      desc: 'Còi báo động rền khắp khu, dân sơ tán. Bắt đầu ở mức căng thẳng cao, nhịp nhanh.',
      seed: 'Còi báo Mùa Rift vừa rú lên khắp khu vực; dân chúng đang sơ tán và nhân vật kẹt lại bên ngoài vành đai an toàn.' },
    { id: 'tuydo', title: 'Tự do — tôi tự mô tả',
      desc: 'Viết bối cảnh mở màn theo ý bạn ở ô ghi chú bên dưới.',
      seed: '' },
  ],

  freeNote: {
    label: 'Ghi chú / yêu cầu riêng cho Quản Trò',
    placeholder: 'VD: tôi muốn giọng kể lạnh, ít hài; NPC đồng hành là một thợ máy Ferrum...',
  },

  /* VP tối đa khởi điểm theo thiên phú. */
  vpByTalent: { 'Phàm Tư': 80, 'Lương Tư': 100, 'Ưu Tư': 120, 'Kỳ Tài': 150, 'Dị Bẩm': 200 },

  /**
   * Ghi thẳng giá trị biểu mẫu vào stat_data — KHÔNG nhờ AI đặt hộ.
   * (Bài học bug 116: để AI tự suy ra hồ sơ từ lời kể thì gần như luôn sai vài trường.)
   */
  applyForm: function (stat, form, scenario) {
    var S = window.STFE;
    var vpMax = (this.vpByTalent[form.thienphu] || 100);
    S.setDeep(stat, 'Nhân Vật.Tên', form.ten || 'Vô Danh');
    S.setDeep(stat, 'Nhân Vật.Tuổi', Number(form.tuoi) || 18);
    S.setDeep(stat, 'Nhân Vật.Phả Hệ', form.phahe || 'Ignis');
    S.setDeep(stat, 'Nhân Vật.Phả Hệ Lai 1', form.phahe === 'Shard Lai' ? (form.lai1 || '') : '');
    S.setDeep(stat, 'Nhân Vật.Phả Hệ Lai 2', form.phahe === 'Shard Lai' ? (form.lai2 || '') : '');
    S.setDeep(stat, 'Nhân Vật.Thiên Phú', form.thienphu || 'Ưu Tư');
    S.setDeep(stat, 'Nhân Vật.Cảnh Giới', form.canhgioi || 'Sơ thức');
    S.setDeep(stat, 'Nhân Vật.Veil-Tech', form.veiltech || 'Không');
    S.setDeep(stat, 'Nhân Vật.Veil-Tech Style', form.vtstyle || '');
    S.setDeep(stat, 'Nhân Vật.VP.Tối Đa', vpMax);
    S.setDeep(stat, 'Nhân Vật.VP.Hiện Tại', vpMax);
    S.setDeep(stat, 'Thế Giới.Khu Vực', form.khuvuc || 'Trung - Đồng Bằng Cộng Hưởng');
    S.setDeep(stat, 'Thế Giới.Bối Cảnh', (scenario && scenario.seed) || form.note || '');
    return stat;
  },

  /** Lời nhắc mở màn. Hồ sơ đã ghi xong, AI chỉ lo dựng cảnh + bổ sung phần động. */
  buildOpeningPrompt: function (form, scenario, stat) {
    var lines = [];
    lines.push('[HỆ THỐNG] Người chơi vừa hoàn tất bảng khởi tạo. Hồ sơ dưới đây ĐÃ được ghi thẳng vào biến, đúng nguyên văn — tuyệt đối không sửa lại, không đặt tên khác, không đổi phả hệ.');
    lines.push('');
    lines.push('HỒ SƠ NHÂN VẬT');
    lines.push('- Tên: ' + (form.ten || 'Vô Danh'));
    lines.push('- Tuổi: ' + (form.tuoi || 18));
    lines.push('- Phả Hệ: ' + (form.phahe || 'Ignis')
      + (form.phahe === 'Shard Lai' ? ' (lai: ' + (form.lai1 || '?') + ' + ' + (form.lai2 || '?') + ')' : ''));
    lines.push('- Thiên Phú: ' + (form.thienphu || 'Ưu Tư'));
    lines.push('- Cảnh Giới: ' + (form.canhgioi || 'Sơ thức') + ' — Tầng 1');
    lines.push('- Veil-Tech: ' + (form.veiltech || 'Không')
      + (form.vtstyle ? ' — phong cách ' + form.vtstyle : ''));
    lines.push('- Khu vực khởi đầu: ' + (form.khuvuc || 'Trung - Đồng Bằng Cộng Hưởng'));
    lines.push('');
    lines.push('BỐI CẢNH MỞ MÀN: ' + ((scenario && scenario.seed) || form.note || 'Người chơi tự do lựa chọn hướng đi.'));
    if (form.note && scenario && scenario.seed) lines.push('YÊU CẦU RIÊNG CỦA NGƯỜI CHƠI: ' + form.note);
    lines.push('');
    lines.push('VIỆC CẦN LÀM TRONG LƯỢT NÀY');
    lines.push('1. Viết cảnh mở màn: đặt nhân vật vào đúng khu vực và bối cảnh trên, có không khí, có ít nhất một NPC có tên và một điều gì đó đang xảy ra ngay lúc này.');
    lines.push('2. Kết cảnh bằng một tình huống mở để người chơi quyết định. KHÔNG hành động hay suy nghĩ thay người chơi.');
    lines.push('3. Sau phần kể, xuất khối cập nhật biến theo đúng định dạng bắt buộc, trong đó:');
    lines.push('   - insert trang bị/vật phẩm khởi đầu hợp lý vào Kho Đồ (2-4 món, đủ trường ID, Tên, Số Lượng, Mô Tả, Container);');
    lines.push('   - insert 1-2 kỹ năng khởi đầu hợp với Phả Hệ vào Kỹ Năng (đủ trường);');
    lines.push('   - insert NPC vừa xuất hiện vào Mối Quan Hệ;');
    lines.push('   - replace Thế Giới.Bối Cảnh bằng một câu tóm tắt tình hình sau cảnh này;');
    lines.push('   - KHÔNG replace lại Tên / Tuổi / Phả Hệ / Thiên Phú / Cảnh Giới / VP.Tối Đa — những trường đó do bảng khởi tạo quyết định.');
    return lines.join('\n');
  },

  /** Ảnh chụp trạng thái gửi kèm mỗi lượt, để AI không quên hồ sơ khi nhật ký bị cắt bớt. */
  buildStateBrief: function (stat) {
    var S = window.STFE;
    var g = function (p, d) { return S.dig(stat, p, d); };
    var kho = g('Kho Đồ', []) || [];
    var kn = g('Kỹ Năng', []) || [];
    var qh = g('Mối Quan Hệ', []) || [];
    var brief = [];
    brief.push('[TRẠNG THÁI HIỆN TẠI — nguồn sự thật, ưu tiên hơn mọi thứ trong nhật ký]');
    brief.push('Thời gian: ' + g('Thế Giới.Giờ', 8) + ' giờ ' + g('Thế Giới.Phút', 0) + ' phút, ngày '
      + g('Thế Giới.Ngày', 1) + '/' + g('Thế Giới.Tháng', 1) + '/' + g('Thế Giới.Năm', 3000) + ' SC');
    brief.push('Khu vực: ' + g('Thế Giới.Khu Vực', '?'));
    brief.push('Bối cảnh: ' + (g('Thế Giới.Bối Cảnh', '') || '(chưa ghi)'));
    brief.push('Nhân vật: ' + g('Nhân Vật.Tên', '?') + ', ' + g('Nhân Vật.Tuổi', '?') + ' tuổi, phả hệ '
      + g('Nhân Vật.Phả Hệ', '?') + ', thiên phú ' + g('Nhân Vật.Thiên Phú', '?')
      + ', cảnh giới ' + g('Nhân Vật.Cảnh Giới', '?') + ' tầng ' + g('Nhân Vật.Tầng', 1)
      + ', cấp hiệu ' + g('Nhân Vật.Cấp Hiệu Trấn Minh', 'Chưa có'));
    brief.push('VP: ' + g('Nhân Vật.VP.Hiện Tại', 0) + '/' + g('Nhân Vật.VP.Tối Đa', 0)
      + ' · Veil Coin ' + g('Tài Sản.Veil Coin', 0)
      + ' · Điểm Công Trấn ' + g('Tài Sản.Điểm Công Trấn', 0)
      + ' · Veil Essence ' + g('Tài Sản.Veil Essence', 0));
    brief.push('Kho đồ (' + kho.length + '): ' + (kho.length
      ? kho.map(function (i) { return i['Tên'] + ' x' + i['Số Lượng']; }).join(', ') : 'trống'));
    brief.push('Kỹ năng (' + kn.length + '): ' + (kn.length
      ? kn.map(function (i) { return i['Tên'] + ' Lv' + i['Level']; }).join(', ') : 'chưa có'));
    brief.push('Quan hệ (' + qh.length + '): ' + (qh.length
      ? qh.map(function (i) { return i['Tên'] + ' (' + i['Mức Độ'] + ')'; }).join(', ') : 'chưa có'));

    // Đo được ở lượt chạy thật: mô hình bịa hẳn đường dẫn `/Thời gian` — không có trong
    // schema, nên MVU lặng lẽ bỏ qua và đồng hồ đứng im. Đưa thẳng bảng đường dẫn hợp lệ
    // vào mỗi lượt rẻ hơn nhiều so với việc đi dò xem vì sao chỉ số không nhúc nhích.
    brief.push('');
    brief.push('[ĐƯỜNG DẪN HỢP LỆ — chép đúng từng chữ hoa và dấu, không có đường nào khác]');
    brief.push('/Thế Giới/Ngày · /Thế Giới/Tháng · /Thế Giới/Năm · /Thế Giới/Giờ · /Thế Giới/Phút'
      + ' · /Thế Giới/Khu Vực · /Thế Giới/Bối Cảnh');
    brief.push('/Nhân Vật/Tên · /Nhân Vật/Tuổi · /Nhân Vật/Phả Hệ · /Nhân Vật/Veil-Tech'
      + ' · /Nhân Vật/Veil-Tech Style · /Nhân Vật/Thiên Phú · /Nhân Vật/Cảnh Giới · /Nhân Vật/Tầng'
      + ' · /Nhân Vật/Cấp Hiệu Trấn Minh · /Nhân Vật/VP/Hiện Tại · /Nhân Vật/VP/Tối Đa');
    brief.push('/Tài Sản/Veil Coin · /Tài Sản/Điểm Công Trấn · /Tài Sản/Veil Essence');
    brief.push('/Kho Đồ/- (thêm) hoặc /Kho Đồ/<số> (sửa) — mỗi món đủ: ID, Tên, Số Lượng, Mô Tả, Container');
    brief.push('/Kỹ Năng/- hoặc /Kỹ Năng/<số> — đủ: Tên, Mô Tả, Level, VP Tiêu Hao, Veil Essence, Veil Essence Cần');
    brief.push('/Mối Quan Hệ/- hoặc /Mối Quan Hệ/<số> — đủ: Tên, Mức Độ, Ghi Chú');
    brief.push('/Containers/- hoặc /Containers/<số> — đủ: Tên, Loại, Dung Tích, Vị Trí');
    brief.push('Muốn đổi thời gian thì sửa /Thế Giới/Giờ và /Thế Giới/Phút bằng delta.'
      + ' KHÔNG có biến nào tên "Thời gian", "Inventory", "Status" hay tương tự — bịa ra là lệnh bị bỏ qua.');
    return brief.join('\n');
  },

  /* ── thanh đầu ───────────────────────────────────────────────────────── */
  header: function (stat) {
    var S = window.STFE;
    var g = function (p, d) { return S.dig(stat, p, d); };
    var pha = g('Nhân Vật.Phả Hệ', '?');
    if (pha === 'Shard Lai') {
      var l1 = g('Nhân Vật.Phả Hệ Lai 1', ''), l2 = g('Nhân Vật.Phả Hệ Lai 2', '');
      if (l1 || l2) pha = 'Shard Lai · ' + [l1, l2].filter(Boolean).join('+');
    }
    var pad = function (n) { return (Number(n) < 10 ? '0' : '') + Number(n); };
    return {
      name: g('Nhân Vật.Tên', 'Vô Danh'),
      chips: [
        { k: 'Ngày', v: g('Thế Giới.Ngày', 1) + '/' + g('Thế Giới.Tháng', 1) + '/' + g('Thế Giới.Năm', 3000) + ' SC' },
        { k: 'Giờ', v: pad(g('Thế Giới.Giờ', 8)) + ':' + pad(g('Thế Giới.Phút', 0)) },
        { k: 'Khu vực', v: g('Thế Giới.Khu Vực', '?') },
        { k: 'Phả hệ', v: pha },
        { k: 'Cảnh giới', v: g('Nhân Vật.Cảnh Giới', '?') + ' · tầng ' + g('Nhân Vật.Tầng', 1) },
        { k: 'Trấn Minh', v: g('Nhân Vật.Cấp Hiệu Trấn Minh', 'Chưa có') },
      ],
      bars: [
        { label: 'VP', cur: Number(g('Nhân Vật.VP.Hiện Tại', 0)), max: Number(g('Nhân Vật.VP.Tối Đa', 100)) || 1,
          color: 'linear-gradient(90deg,#4dd6c1,#7aa2ff)' },
      ],
      money: [
        { k: 'Veil Coin', v: g('Tài Sản.Veil Coin', 0) },
        { k: 'Điểm Công Trấn', v: g('Tài Sản.Điểm Công Trấn', 0) },
        { k: 'Veil Essence', v: g('Tài Sản.Veil Essence', 0) },
      ],
    };
  },

  /* ── các tab của màn chính ───────────────────────────────────────────── */
  panels: [
    { id: 'chat', label: '📜 Nhật ký', type: 'chat' },
    {
      id: 'nhanvat', label: '🧬 Nhân vật', type: 'fields',
      fields: [
        { k: 'Tên', p: 'Nhân Vật.Tên' },
        { k: 'Tuổi', p: 'Nhân Vật.Tuổi' },
        { k: 'Phả Hệ', p: 'Nhân Vật.Phả Hệ' },
        { k: 'Phả Hệ Lai 1', p: 'Nhân Vật.Phả Hệ Lai 1', hideEmpty: true },
        { k: 'Phả Hệ Lai 2', p: 'Nhân Vật.Phả Hệ Lai 2', hideEmpty: true },
        { k: 'Thiên Phú', p: 'Nhân Vật.Thiên Phú' },
        { k: 'Cảnh Giới', p: 'Nhân Vật.Cảnh Giới' },
        { k: 'Tầng', p: 'Nhân Vật.Tầng' },
        { k: 'Cấp Hiệu Trấn Minh', p: 'Nhân Vật.Cấp Hiệu Trấn Minh' },
        { k: 'Veil-Tech', p: 'Nhân Vật.Veil-Tech' },
        { k: 'Phong cách Veil-Tech', p: 'Nhân Vật.Veil-Tech Style', hideEmpty: true },
        { k: 'VP', p: 'Nhân Vật.VP.Hiện Tại', suffix: 'p2', p2: 'Nhân Vật.VP.Tối Đa' },
      ],
    },
    {
      id: 'khodo', label: '🎒 Kho đồ', type: 'list', path: 'Kho Đồ',
      name: 'Tên', tag: 'Số Lượng', tagPrefix: 'x', desc: 'Mô Tả', groupBy: 'Container',
      empty: 'Chưa có vật phẩm nào.',
      before: { type: 'fields', title: 'Túi chứa', listPath: 'Containers', name: 'Tên', desc: 'Vị Trí', tag: 'Dung Tích' },
    },
    {
      id: 'kynang', label: '⚡ Kỹ năng', type: 'list', path: 'Kỹ Năng',
      name: 'Tên', tag: 'Level', tagPrefix: 'Lv ', desc: 'Mô Tả',
      bar: { cur: 'Veil Essence', max: 'Veil Essence Cần', label: 'Essence' },
      note: [{ k: 'VP tiêu hao', p: 'VP Tiêu Hao' }],
      empty: 'Chưa học kỹ năng nào.',
    },
    {
      id: 'quanhe', label: '🤝 Quan hệ', type: 'list', path: 'Mối Quan Hệ',
      name: 'Tên', tag: 'Mức Độ', desc: 'Ghi Chú',
      empty: 'Chưa quen ai.',
    },
    {
      id: 'thegioi', label: '🌍 Thế giới', type: 'fields',
      fields: [
        { k: 'Ngày', p: 'Thế Giới.Ngày' },
        { k: 'Tháng', p: 'Thế Giới.Tháng' },
        { k: 'Năm', p: 'Thế Giới.Năm' },
        { k: 'Giờ', p: 'Thế Giới.Giờ' },
        { k: 'Phút', p: 'Thế Giới.Phút' },
        { k: 'Khu Vực', p: 'Thế Giới.Khu Vực' },
        { k: 'Bối Cảnh', p: 'Thế Giới.Bối Cảnh', wide: true },
      ],
    },
    {
      id: 'taisan', label: '💠 Tài sản', type: 'fields',
      fields: [
        { k: 'Veil Coin', p: 'Tài Sản.Veil Coin' },
        { k: 'Điểm Công Trấn', p: 'Tài Sản.Điểm Công Trấn' },
        { k: 'Veil Essence', p: 'Tài Sản.Veil Essence' },
      ],
    },
  ],

  /* Gợi ý hành động nhanh, bấm là điền vào ô nhập. */
  quickActions: [
    'Quan sát kỹ xung quanh.',
    'Bắt chuyện với người gần nhất.',
    'Kiểm tra kho đồ và trang bị.',
    'Vận Veil, dò xem có dị thường gì không.',
    'Nghỉ ngơi một lát cho hồi VP.',
  ],
};
