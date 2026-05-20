@@preprocessing
<%_
// ═══════════════════════════════════════════════════════════
// 【Khu vực 1】Biến cơ bản
// ═══════════════════════════════════════════════════════════
if (typeof _isF0 === 'undefined') var _isF0 = (typeof lastUserMessageId === 'undefined' || lastUserMessageId === null);
if (typeof _era === 'undefined') var _era = getvar('stat_data.Trạng thái thế giới.Thời đại hiện tại', { defaults: 'Đấu 1' });
if (typeof _period === 'undefined') var _period = getvar('stat_data.Trạng thái thế giới.Thời kỳ niên biểu', { defaults: 'Tiền kỳ' });
if (typeof _chapter === 'undefined') var _chapter = getvar('stat_data.Trạng thái thế giới.Chương cốt truyện', { defaults: 'Tự chương' });
if (typeof _area === 'undefined') var _area = getvar('stat_data.Trạng thái thế giới.Khu vực hiện tại', { defaults: '' });
if (typeof _scene === 'undefined') var _scene = getvar('stat_data.Trạng thái thế giới.Cảnh hiện tại', { defaults: '' });
if (typeof _sType === 'undefined') var _sType = getvar('stat_data.Trạng thái thế giới.Loại cảnh hiện tại', { defaults: 'Hàng ngày' });
if (typeof _identity === 'undefined') var _identity = getvar('stat_data.Người chơi.Thông tin cơ bản.Chủng tộc', { defaults: 'Nhân loại' });
if (typeof _soulLevel === 'undefined') var _soulLevel = getvar('stat_data.Người chơi.Trạng thái tu luyện.Cấp bậc hồn lực', { defaults: 0 });

// ═══════════════════════════════════════════════════════════
// 【Khu vực 2】Quét văn bản trò chuyện (3 tin nhắn gần nhất của user+AI)
// ═══════════════════════════════════════════════════════════
if (typeof _txt === 'undefined') {
  var _txt = '';
  if (typeof getChatMessages === 'function') {
    var _um = getChatMessages(-1, 'user');
    var _am = getChatMessages(- 1, 'assistant');
    var _un = Math.min(3, _um.length);
    var _an = Math.min(3, _am.length);
    for (var _i = _um.length - _un; _i < _um.length; _i++) { _txt += _um[_i] + ' '; }
    for (var _j = _am.length - _an; _j < _am.length; _j++) { _txt += _am[_j] + ' '; }
  }
}
if (typeof _f === 'undefined') var _f = (_area || '') + ' ' + (_scene || '') + ' ' + _txt;

// ═══════════════════════════════════════════════════════════
// 【Khu vực 3】Bảng ánh xạ bí danh NPC + Kiểm tra
// ═══════════════════════════════════════════════════════════
if (typeof _npcs === 'undefined') {
  var _nm = {};

  if (_era === 'Đấu 1') {
    _nm = {
      "Đường Tam": 'Đường Tam', "Tiểu Tam": 'Tiểu Tam', "Tam ca": 'Tam ca',
      "Tiểu Vũ": 'Tiểu Vũ',
      "Đới Mộc Bạch": 'Đới Mộc Bạch', "Đới lão đại": 'Đới lão đại', "Mộc Bạch": 'Mộc Bạch',
      "Chu Trúc Thanh": 'Chu Trúc Thanh', "Trúc Thanh": 'Trúc Thanh',
      "Ninh Vinh Vinh": 'Ninh Vinh Vinh', "Vinh Vinh": 'Vinh Vinh',
      "Áo Tư Tạp": 'Áo Tư Tạp', "Tiểu Áo": 'Tiểu Áo',
      "Mã Hồng Tuấn": 'Mã Hồng Tuấn', "Hồng Tuấn": 'Hồng Tuấn',
      "Bỉ Bỉ Đông": 'Bỉ Bỉ Đông', "Giáo hoàng": 'Giáo hoàng', "Đông nhi": 'Đông nhi',
      "Thiên Nhận Tuyết": 'Thiên Nhận Tuyết', "Lục Dực Thiên Sứ": 'Lục Dực Thiên Sứ', "Thiên Sứ Thần": 'Thiên Sứ Thần', "Tiểu Tuyết": 'Tiểu Tuyết',
      "Bạch Trầm Hương": 'Bạch Trầm Hương', "Hương Hương": 'Hương Hương',
      "Hồ Liệt Na": 'Hồ Liệt Na', "Na Na": 'Na Na', "Thánh nữ": 'Thánh nữ',
      "Cúc Đấu La": 'Cúc Đấu La', "Cúc Hoa Quan": 'Cúc Hoa Quan', "Nguyệt Quan": 'Nguyệt Quan',
      "Quỷ Đấu La": 'Quỷ Đấu La', "Quỷ Mị": 'Quỷ Mị',
      "Thiên Đạo Lưu": 'Thiên Đạo Lưu', "Đại cung phụng": 'Đại cung phụng',
      "Ngọc Tiểu Cương": 'Ngọc Tiểu Cương', "Đại sư": 'Đại sư',
      "Liễu Nhị Long": 'Liễu Nhị Long', "Nhị Long": 'Nhị Long',
      "Phất Lan Đức": 'Phất Lan Đức', "Viện trưởng Phất Lan Đức": 'Viện trưởng Phất Lan Đức',
      "Triệu Vô Cực": 'Triệu Vô Cực', "Triệu lão sư": 'Triệu lão sư',
      "Đường Hạo": 'Đường Hạo', "Hạo Thiên Đấu La": 'Hạo Thiên Đấu La',
      "A Ngân": 'A Ngân', "Lam Ngân Hoàng": 'Lam Ngân Hoàng',
      "Đường Khiếu": 'Đường Khiếu', "Khiếu Thiên Đấu La": 'Khiếu Thiên Đấu La',
      "Đường Nguyệt Hoa": 'Đường Nguyệt Hoa',
      "Đường Thần": 'Đường Thần',
      "Tuyết Thanh Hà": 'Tuyết Thanh Hà', "Thái tử": 'Thái tử',
      "Ninh Phong Trí": 'Ninh Phong Trí', "Phong Trí": 'Phong Trí',
      "Kiếm Đấu La": 'Kiếm Đấu La', "Trần Tâm": 'Trần Tâm', "Thất Sát Kiếm": 'Thất Sát Kiếm',
      "Cốt Đấu La": 'Cốt Đấu La', "Cổ Dung": 'Cổ Dung', "Cốt Long": 'Cốt Long',
      "Đới Duy Tư": 'Đới Duy Tư',
      "Chu Trúc Vân": 'Chu Trúc Vân',
      "Độc Cô Bác": 'Độc Cô Bác', "Độc Đấu La": 'Độc Đấu La',
      "Độc Cô Nhạn": 'Độc Cô Nhạn', "Nhạn Nhạn": 'Nhạn Nhạn', "Nhạn Tử": 'Nhạn Tử',
      "Diễm": 'Diễm', "Hỏa Diễm Lĩnh Chủ": 'Hỏa Diễm Lĩnh Chủ',
      "Tà Nguyệt": 'Tà Nguyệt',
      "Ba Tắc Tây": 'Ba Tắc Tây', "Hải Thần Đấu La": 'Hải Thần Đấu La',
      "Tần Minh": 'Tần Minh',
      "Hỏa Vũ": 'Hỏa Vũ',
      "Phong Tiếu Thiên": 'Phong Tiếu Thiên', "Tật Phong Song Đầu Lang": 'Tật Phong Song Đầu Lang',
      "Thủy Băng Nhi": 'Thủy Băng Nhi', "Thiên Thủy": 'Thiên Thủy', "Băng Phượng Hoàng": 'Băng Phượng Hoàng',
      "Diệp Lãnh Lãnh": 'Diệp Lãnh Lãnh', "Cửu Tâm Hải Đường": 'Cửu Tâm Hải Đường',
      "Ngọc Thiên Hằng": 'Ngọc Thiên Hằng',
      "Long Công": 'Long Công', "Mạnh Thục": 'Mạnh Thục',
      "Xà Bà": 'Xà Bà', "Triều Thiên Hương": 'Triều Thiên Hương',
      "Mạnh Y Nhiên": 'Mạnh Y Nhiên', "Y Nhiên": 'Y Nhiên',
      "Tiểu Bạch": 'Tiểu Bạch', "Ma Hồn Đại Bạch Sa": 'Ma Hồn Đại Bạch Sa',
      "Đại Minh": 'Đại Minh', "Thiên Thanh Ngưu Mãng": 'Thiên Thanh Ngưu Mãng',
      "Nhị Minh": 'Nhị Minh', "Thái Thản Cự Viên": 'Thái Thản Cự Viên'
    };
  } else if (_era === 'Đấu 2') {
    _nm = {
      "Hoắc Vũ Hạo": 'Hoắc Vũ Hạo', "Vũ Hạo": 'Vũ Hạo',
      "Hoắc Vũ Đồng": 'Hoắc Vũ Đồng', "Vũ Đồng": 'Vũ Đồng',
      "Đường Nhã": 'Đường Nhã', "Tiểu Nhã": 'Tiểu Nhã', "Lam Ngân Thánh Nữ": 'Lam Ngân Thánh Nữ', "Tiểu Nhã tỷ": 'Tiểu Nhã tỷ',
      "Bối Bối": 'Bối Bối', "Đại sư huynh": 'Đại sư huynh',
      "Vương Đông": 'Vương Đông', "Vương Đông Nhi": 'Vương Đông Nhi', "Đông Nhi": 'Đông Nhi', "Đường Vũ Đồng": 'Đường Vũ Đồng', "Tiểu Thất": 'Tiểu Thất', "Vũ Đồng": 'Vũ Đồng',
      "Hòa Thái Đầu": 'Hòa Thái Đầu', "Từ Hòa": 'Từ Hòa', "Hòa đại ca": 'Hòa đại ca',
      "Tiêu Tiêu": 'Tiêu Tiêu',
      "Từ Tam Thạch": 'Từ Tam Thạch', "Tam Thạch": 'Tam Thạch',
      "Giang Nam Nam": 'Giang Nam Nam', "Nam Nam": 'Nam Nam', "Nam Nam tỷ": 'Nam Nam tỷ',
      "Chu Lộ": 'Chu Lộ',
      "Đới Hoa Bân": 'Đới Hoa Bân',
      "Vu Phong": 'Vu Phong', "Phong muội": 'Phong muội',
      "Ninh Thiên": 'Ninh Thiên', "Tiểu Thiên": 'Tiểu Thiên', "Thiên tỷ": 'Thiên tỷ', "Thiếu chủ": 'Thiếu chủ',
      "Trương Nhạc Huyên": 'Trương Nhạc Huyên', "Nhạc Huyên": 'Nhạc Huyên', "Đại sư tỷ": 'Đại sư tỷ', "Nhạc Huyên tỷ": 'Nhạc Huyên tỷ',
      "Mã Tiểu Đào": 'Mã Tiểu Đào', "Tiểu Đào": 'Tiểu Đào', "Tiểu Đào tỷ": 'Tiểu Đào tỷ',
      "Hàn Nhược Nhược": 'Hàn Nhược Nhược', "Nhược Nhược tỷ": 'Nhược Nhược tỷ',
      "Ngũ Mính": 'Ngũ Mính', "Kim Ô": 'Kim Ô',
      "Mộc Cẩn": 'Mộc Cẩn', "Mộc lão sư": 'Mộc lão sư',
      "Lăng Lạc Hoàn": 'Lăng Lạc Hoàn', "Lăng học tỷ": 'Lăng học tỷ',
      "Trần Tử Phong": 'Trần Tử Phong',
      "Kinh Tử Yên": 'Kinh Tử Yên',
      "Quý Tuyệt Trần": 'Quý Tuyệt Trần',
      "Sở Khuynh Thiên": 'Sở Khuynh Thiên',
      "Nam Môn Duẫn Nhi": 'Nam Môn Duẫn Nhi', "Duẫn Nhi": 'Duẫn Nhi',
      "Thôi Nhã Khiết": 'Thôi Nhã Khiết',
      "Lam Lạc Lạc": 'Lam Lạc Lạc', "Lạc Lạc": 'Lạc Lạc',
      "Lam Tố Tố": 'Lam Tố Tố', "Tố Tố": 'Tố Tố',
      "Hoàng Sở Thiên": 'Hoàng Sở Thiên',
      "Tà Huyễn Nguyệt": 'Tà Huyễn Nguyệt',
      "Tào Cẩn Hiên": 'Tào Cẩn Hiên',
      "Chu Tư Trần": 'Chu Tư Trần',
      "Đỗ Duy Luân": 'Đỗ Duy Luân', "Đỗ chủ nhiệm": 'Đỗ chủ nhiệm',
      "Vương Ngôn": 'Vương Ngôn', "Vương lão sư": 'Vương lão sư',
      "Phàm Vũ": 'Phàm Vũ',
      "Chu Y": 'Chu Y', "Chu lão sư": 'Chu lão sư',
      "Thái Mị Nhi": 'Thái Mị Nhi', "Thái viện trưởng": 'Thái viện trưởng',
      "Ngôn Thiếu Triết": 'Ngôn Thiếu Triết', "Ngôn viện trưởng": 'Ngôn viện trưởng', "Minh Phượng Đấu La": 'Minh Phượng Đấu La',
      "Tiên Lâm Nhi": 'Tiên Lâm Nhi', "Võ Thần Đấu La": 'Võ Thần Đấu La',
      "Tiền Đa Đa": 'Tiền Đa Đa', "Tiền viện trưởng": 'Tiền viện trưởng',
      "Mục Ân": 'Mục Ân', "Long Thần Đấu La": 'Long Thần Đấu La',
      "Huyền Tử": 'Huyền Tử', "Huyền lão": 'Huyền lão', "Thao Thiết Đấu La": 'Thao Thiết Đấu La', "Kê Thối Đấu La": 'Kê Thối Đấu La',
      "Cung Trường Long": 'Cung Trường Long',
      "Thời Hưng": 'Thời Hưng', "Thành chủ Sử Lai Khắc Thành": 'Thành chủ Sử Lai Khắc Thành',
      "Tống lão": 'Tống lão',
      "Trang lão": 'Trang lão',
      "Lâm Tuệ Quần": 'Lâm Tuệ Quần',
      "Đới Lạc Lê": 'Đới Lạc Lê',
      "Đới Hạo": 'Đới Hạo', "Bạch Hổ Công Tước": 'Bạch Hổ Công Tước',
      "Mẹ Đới Lạc Lê": 'Mẹ Đới Lạc Lê', "Tô Vinh": 'Tô Vinh',
      "Bạch Hổ Công Tước Phu Nhân": 'Bạch Hổ Công Tước Phu Nhân', "Chu Châu": 'Chu Châu',
      "Đới Dược Hành": 'Đới Dược Hành',
      "Hoắc Vân Nhi": 'Hoắc Vân Nhi',
      "Công Dương Mặc": 'Công Dương Mặc',
      "Diêu Hạo Hiên": 'Diêu Hạo Hiên',
      "Tây Tây": 'Tây Tây',
      "Trình Cương": 'Trình Cương', "Cự Lực Đấu La": 'Cự Lực Đấu La',
      "Hoàng Tân Tự": 'Hoàng Tân Tự', "Thiên Sát Đấu La": 'Thiên Sát Đấu La',
      "Vương Tiên Nhi": 'Vương Tiên Nhi', "Y Tiên Đấu La": 'Y Tiên Đấu La',
      "Long Ngạo Thiên": 'Long Ngạo Thiên',
      "Độc Bất Tử": 'Độc Bất Tử', "Bản Thể Đấu La": 'Bản Thể Đấu La',
      "Long Tiêu Dao": 'Long Tiêu Dao', "Long Hoàng Đấu La": 'Long Hoàng Đấu La',
      "Trương Bằng": 'Trương Bằng', "Hạt Hổ Đấu La": 'Hạt Hổ Đấu La',
      "Phượng Lăng": 'Phượng Lăng', "Phong Lăng": 'Phong Lăng', "Tà Phượng Đấu La": 'Tà Phượng Đấu La',
      "Chung Ly Ô": 'Chung Ly Ô', "Giáo chủ Thánh Linh Giáo": 'Giáo chủ Thánh Linh Giáo',
      "Mộ Tuyết": 'Mộ Tuyết',
      "Duy Na": 'Duy Na', "Công chúa Thiên Hồn": 'Công chúa Thiên Hồn',
      "Quất Tử": 'Quất Tử',
      "Ngọc Thiên Long": 'Ngọc Thiên Long',
      "Tiếu Hồng Trần": 'Tiếu Hồng Trần',
      "Mộng Hồng Trần": 'Mộng Hồng Trần',
      "Kính Hồng Trần": 'Kính Hồng Trần', "Đường chủ Minh Đức Đường": 'Đường chủ Minh Đức Đường',
      "Diệp Vũ Lâm": 'Diệp Vũ Lâm',
      "Khổng Đức Minh": 'Khổng Đức Minh',
      "Từ Thiên Chân": 'Từ Thiên Chân',
      "Từ Thiên Nhiên": 'Từ Thiên Nhiên', "Thái tử": 'Thái tử',
      "Diệp Cốt Y": 'Diệp Cốt Y',
      "Diệp Tịch Thủy": 'Diệp Tịch Thủy',
      "Hứa Cửu Cửu": 'Hứa Cửu Cửu', "Cửu Cửu": 'Cửu Cửu', "Công chúa Cửu Cửu": 'Công chúa Cửu Cửu',
      "Hứa Gia Vĩ": 'Hứa Gia Vĩ', "Hoàng đế Tinh La": 'Hoàng đế Tinh La',
      "Mã Như Long": 'Mã Như Long',
      "Cao Đại Lâu": 'Cao Đại Lâu',
      "Vương Thu Nhi": 'Vương Thu Nhi', "Đế Hoàng Thụy Thú": 'Đế Hoàng Thụy Thú',
      "Xích Vương": 'Xích Vương',
      "Bích Cơ": 'Bích Cơ',
      "Hùng Quân": 'Hùng Quân',
      "Đế Thiên": 'Đế Thiên', "Kim Nhãn Hắc Long Vương": 'Kim Nhãn Hắc Long Vương',
      "Cổ Nguyệt Na": 'Cổ Nguyệt Na', "Ngân Long Vương": 'Ngân Long Vương',
      "Tử Cơ": 'Tử Cơ',
      "Vạn Yêu Vương": 'Vạn Yêu Vương',
      "Thiên Mộng": 'Thiên Mộng Băng Tàm', "Thiên Mộng Băng Tàm": 'Thiên Mộng Băng Tàm',
      "Y Lai Khắc Tư": 'Y Lai Khắc Tư', "Y lão": 'Y lão', "Vong Linh Thánh Pháp Thần": 'Vong Linh Thánh Pháp Thần',
      "Tiểu Bạch": 'Tiểu Bạch(Băng Hùng Vương)', "Băng Hùng Vương": 'Tiểu Bạch(Băng Hùng Vương)',
      "Thái Thản Tuyết Ma Vương": 'Thái Thản Tuyết Ma Vương', "A Nặc": 'Thái Thản Tuyết Ma Vương',
      "Băng Đế": 'Băng Đế', "Băng Băng": 'Băng Băng',
      "Tuyết Đế": 'Tuyết Đế', "Tuyết Nhi": 'Tuyết Nhi', "Băng Thiên Tuyết Nữ": 'Băng Thiên Tuyết Nữ',
      "Tà Đế": 'Tà Đế', "Tà Nhãn Bạo Quân": 'Tà Nhãn Bạo Quân',
      "Bát Giác Huyền Băng Thảo": 'Bát Giác Huyền Băng Thảo',
      "U U": 'U U', "U Hương Khỉ La Tiên Phẩm": 'U Hương Khỉ La Tiên Phẩm',
      "Hải Công Chúa": 'Hải Công Chúa', "Nhân ngư": 'Hải Công Chúa',
      "Lệ Nhã": 'Lệ Nhã',
      "Nam Thu Thu": 'Nam Thu Thu', "Yên Chi Long": 'Yên Chi Long',
      "Nam Thủy Thủy": 'Nam Thủy Thủy',
      "Kiều Kiều": 'Kiều Kiều', "Liệt Hỏa Hạnh Kiều Sơ": 'Liệt Hỏa Hạnh Kiều Sơ',
      "Hiên Tử Văn": 'Hiên Tử Văn',
      "Kha Kha": 'Kha Kha',
      "U Linh Na Na": 'U Linh Na Na', "Na Na": 'U Linh Na Na',
      "Ngưu Thiên": 'Ngưu Thiên', "Đại Minh": 'Ngưu Thiên', "Thiên Thanh Ngưu Mãng": 'Ngưu Thiên',
      "Thái Thản": 'Thái Thản', "Nhị Minh": 'Thái Thản',
      "Ninh Vinh Vinh": 'Ninh Vinh Vinh(Đấu 2)', "Cửu Thải Thần Nữ": 'Ninh Vinh Vinh(Đấu 2)',
      "Tiểu Vũ": 'Tiểu Vũ(Đấu 2)', "Tu La Kiếm Sao": 'Tiểu Vũ(Đấu 2)',
      "Đường Tam": 'Đường Tam(Đấu 2)', "Hải Thần": 'Đường Tam(Đấu 2)', "Tu La Thần": 'Đường Tam(Đấu 2)',
      "Mã Hồng Tuấn": 'Mã Hồng Tuấn(Đấu 2)',
      "Áo Tư Tạp": 'Áo Tư Tạp(Đấu 2)',
      "Chu Trúc Thanh": 'Chu Trúc Thanh(Đấu 2)', "Tốc Độ Chi Thần": 'Chu Trúc Thanh(Đấu 2)',
      "Đới Mộc Bạch": 'Đới Mộc Bạch(Đấu 2)', "Chiến Thần": 'Đới Mộc Bạch(Đấu 2)',
      "Sinh Mệnh Chi Thần": 'Sinh Mệnh Chi Thần',
      "Hủy Diệt Chi Thần": 'Hủy Diệt Chi Thần',
      "Dung Niệm Băng": 'Dung Niệm Băng', "Tình Tự Chi Thần": 'Dung Niệm Băng',
      "A Ngân": 'A Ngân(Đấu 2)', "Hoàng Kim Thụ": 'A Ngân(Đấu 2)',
      "Đường Hạo": 'Đường Hạo(Đấu 2)', "Vị Diện Chi Chủ": 'Đường Hạo(Đấu 2)'
    };
  } else if (_era === 'Đấu 3') {
    _nm = {
      "Đường Vũ Lân": 'Đường Vũ Lân', "Vũ Lân": 'Đường Vũ Lân',
      "Cổ Nguyệt": 'Cổ Nguyệt', "Cổ Nguyệt Na": 'Cổ Nguyệt', "Ngân Long Vương": 'Cổ Nguyệt',
      "Tạ Giải": 'Tạ Giải',
      "Nguyên Ân Dạ Huy": 'Nguyên Ân Dạ Huy', "Dạ Huy": 'Nguyên Ân Dạ Huy',
      "Nhạc Chính Vũ": 'Nhạc Chính Vũ',
      "Hứa Tiểu Ngôn": 'Hứa Tiểu Ngôn', "Tiểu Ngôn": 'Hứa Tiểu Ngôn',
      "Từ Lạp Trí": 'Từ Lạp Trí',
      "Diệp Tinh Lan": 'Diệp Tinh Lan', "Tinh Lan": 'Diệp Tinh Lan',
      "Đường Tư Nhiên": 'Đường Tư Nhiên',
      "Lang Nguyệt": 'Lang Nguyệt',
      "Na Nhi": 'Na Nhi',
      "Vũ Trường Không": 'Vũ Trường Không', "Vũ lão sư": 'Vũ lão sư', "Thiên Sương Đấu La": 'Thiên Sương Đấu La',
      "Chu Trường Khê": 'Chu Trường Khê',
      "Vân Tiểu": 'Vân Tiểu',
      "Trương Dương Tử": 'Trương Dương Tử',
      "Vương Kim Tỉ": 'Vương Kim Tỉ',
      "Hứa Hiểu Ngữ": 'Hứa Hiểu Ngữ',
      "Vi Tiểu Phong": 'Vi Tiểu Phong',
      "Long Hằng Húc": 'Long Hằng Húc',
      "Úc Trẫm": 'Úc Trẫm',
      "Lâm Tích Mộng": 'Lâm Tích Mộng',
      "Quang Long": 'Quang Long',
      "Quang Tiêu": 'Quang Tiêu',
      "Âu Dương Tử Hinh": 'Âu Dương Tử Hinh',
      "Chu Hàn U": 'Chu Hàn U',
      "Chu Thiên Nhi": 'Chu Thiên Nhi',
      "Mang Thiên": 'Mang Thiên',
      "Mộ Thần": 'Mộ Thần',
      "Mộ Hi": 'Mộ Hi',
      "Phong Vô Vũ": 'Phong Vô Vũ',
      "Chấn Hoa": 'Chấn Hoa', "Thần Tượng": 'Thần Tượng',
      "Sầm Nhạc": 'Sầm Nhạc',
      "Lý Sát": 'Lý Sát',
      "Lâm Dục Hàm": 'Lâm Dục Hàm',
      "Vân Minh": 'Vân Minh', "Kình Thiên Đấu La": 'Kình Thiên Đấu La',
      "Nhã Lị": 'Nhã Lị', "Thánh Linh Đấu La": 'Thánh Linh Đấu La',
      "Thái Nguyệt Nhi": 'Thái Nguyệt Nhi', "Thái lão": 'Thái lão', "Ngân Nguyệt Đấu La": 'Ngân Nguyệt Đấu La',
      "Trọc Thế": 'Trọc Thế', "Xích Long Đấu La": 'Xích Long Đấu La',
      "Long Dạ Nguyệt": 'Long Dạ Nguyệt', "Quang Ám Đấu La": 'Quang Ám Đấu La',
      "Thẩm Tập": 'Thẩm Tập',
      "Ngô Pháp": 'Ngô Pháp Ngô Thiên', "Ngô Thiên": 'Ngô Pháp Ngô Thiên',
      "Vũ Ti Đóa": 'Vũ Ti Đóa',
      "Lạc Quế Tinh": 'Lạc Quế Tinh',
      "Trịnh Di Nhiên": 'Trịnh Di Nhiên',
      "Từ Du Trình": 'Từ Du Trình',
      "Dương Niệm Hạ": 'Dương Niệm Hạ',
      "Đới Thiên": 'Đới Thiên',
      "Tuyết Lưu Tinh": 'Tuyết Lưu Tinh',
      "Mặc Giác": 'Mặc Giác',
      "Lý Càn Khôn": 'Lý Càn Khôn',
      "Lam Mộc Tử": 'Lam Mộc Tử',
      "Đường Âm Mộng": 'Đường Âm Mộng',
      "Nguyên Ân Chấn Thiên": 'Nguyên Ân Chấn Thiên',
      "Nguyên Ân Thiên Thương": 'Nguyên Ân Thiên Thương',
      "Tang Hâm": 'Tang Hâm', "Đa Tình Đấu La": 'Đa Tình Đấu La',
      "Tào Đức Trí": 'Tào Đức Trí', "Vô Tình Đấu La": 'Vô Tình Đấu La', "Huyết Nhất": 'Huyết Nhất',
      "Triệu Đường Chủ": 'Triệu Đường Chủ',
      "Lương Hiểu Vũ": 'Lương Hiểu Vũ', "Ám Ảnh Đấu La": 'Ám Ảnh Đấu La',
      "Quách Trận Vũ": 'Quách Trận Vũ',
      "Hiên Vũ": 'Hiên Vũ',
      "Lăng Tử Thần": 'Lăng Tử Thần',
      "Thiên Cổ Đông Phong": 'Thiên Cổ Đông Phong',
      "Thiên Cổ Điệt Đình": 'Thiên Cổ Điệt Đình',
      "Thiên Cổ Trượng Đình": 'Thiên Cổ Trượng Đình',
      "Thiên Cổ Thanh Phong": 'Thiên Cổ Thanh Phong',
      "Lãnh Dao Thù": 'Lãnh Dao Thù', "Thiên Phượng Đấu La": 'Thiên Phượng Đấu La',
      "Trương Qua Dương": 'Trương Qua Dương',
      "Huyễn Não Đấu La": 'Huyễn Não Đấu La',
      "Bạch Dung Dung": 'Bạch Dung Dung',
      "Bạch Bình Bình": 'Bạch Bình Bình',
      "Trần Tân Kiệt": 'Trần Tân Kiệt', "Hãn Hải Đấu La": 'Hãn Hải Đấu La',
      "Quan Nguyệt": 'Quan Nguyệt', "Việt Thiên Đấu La": 'Việt Thiên Đấu La',
      "Ngao Duệ": 'Ngao Duệ', "Hạo Nhật Đấu La": 'Hạo Nhật Đấu La',
      "Thạch Mộng San": 'Thạch Mộng San', "Hải Đường Đấu La": 'Hải Đường Đấu La',
      "Nam Cung Dật": 'Nam Cung Dật', "Kháng Long Đấu La": 'Kháng Long Đấu La',
      "Mạc Tử Hồng": 'Mạc Tử Hồng', "Ma Cầm Đấu La": 'Ma Cầm Đấu La',
      "Long Thiên Vũ": 'Long Thiên Vũ', "Đế Kiếm Đấu La": 'Đế Kiếm Đấu La',
      "Lạc Thiều Phong": 'Lạc Thiều Phong',
      "Đổng Tử An": 'Đổng Tử An', "Hung Lang Đấu La": 'Hung Lang Đấu La',
      "Khương Chiến Hằng": 'Khương Chiến Hằng', "Lôi Viêm Đấu La": 'Lôi Viêm Đấu La',
      "Trương Huyễn Vân": 'Trương Huyễn Vân',
      "Long Vũ Tuyết": 'Long Vũ Tuyết',
      "Long Thiên Võ": 'Long Thiên Võ',
      "Giang Ngũ Nguyệt": 'Giang Ngũ Nguyệt',
      "Mã Sơn": 'Huyết Bát', "Huyết Bát": 'Huyết Bát',
      "Thẩm Tinh": 'Thẩm Tinh',
      "Thẩm Nguyệt": 'Thẩm Nguyệt',
      "Mục Dã": 'Mục Dã',
      "A Như Hằng": 'A Như Hằng',
      "Tư Mã Kim Trì": 'Tư Mã Kim Trì',
      "Mặc Lam": 'Mặc Lam',
      "Nhạc Chính Ân": 'Nhạc Chính Ân',
      "Vưu Đỉnh Trí": 'Vưu Đỉnh Trí',
      "Long Trần": 'Long Trần',
      "Ma Hoàng": 'Ma Hoàng',
      "Cáp Lạc Tát": 'Cáp Lạc Tát', "Minh Vương Đấu La": 'Minh Vương Đấu La', "Minh Đế": 'Minh Đế',
      "Quỷ Đế": 'Quỷ Đế',
      "Lãnh Vũ Lai": 'Lãnh Vũ Lai', "Ám Phượng Đấu La": 'Ám Phượng Đấu La',
      "Lam Phật Tử": 'Lam Phật Tử',
      "Hắc Ám Huyết Ma": 'Hắc Ám Huyết Ma',
      "Hắc Ám Phong Điểu": 'Hắc Ám Phong Điểu',
      "Na Na Lị": 'Na Na Lị', "Hắc Ám Linh Đang": 'Hắc Ám Linh Đang',
      "Đới Thiên Linh": 'Đới Thiên Linh', "Hoàng đế Tinh La": 'Hoàng đế Tinh La',
      "Đới Nguyệt Viêm": 'Đới Nguyệt Viêm',
      "Đới Vân Nhi": 'Đới Vân Nhi',
      "Long Dược": 'Long Dược',
      "Ân Từ": 'Ân Từ', "Thánh Long Đấu La": 'Thánh Long Đấu La',
      "Tô Mộc": 'Tô Mộc',
      "Hoa Lam Đường": 'Hoa Lam Đường',
      "Diệp Chỉ": 'Diệp Chỉ',
      "Đằng Đằng": 'Đằng Đằng',
      "Lâm Tam": 'Lâm Tam',
      "Ảnh Nhi": 'Ảnh Nhi',
      "Đồng Vũ": 'Đồng Vũ', "Kỳ Lân Đấu La": 'Kỳ Lân Đấu La',
      "Sở Thiên Ca": 'Sở Thiên Ca', "Khấp Huyết Đấu La": 'Khấp Huyết Đấu La',
      "Hoàng Chính Dương": 'Hoàng Chính Dương',
      "Đế Thiên": 'Đế Thiên', "Kim Nhãn Hắc Long Vương": 'Kim Nhãn Hắc Long Vương', "Thú Thần": 'Thú Thần',
      "Đại Minh": 'Đại Minh', "Thiên Thanh Ngưu Mãng": 'Thiên Thanh Ngưu Mãng',
      "Nhị Minh": 'Nhị Minh', "Thái Thản Cự Viên": 'Thái Thản Cự Viên',
      "Bích Cơ": 'Bích Cơ',
      "Tử Cơ": 'Tử Cơ',
      "Vạn Yêu Vương": 'Vạn Yêu Vương',
      "Hùng Quân": 'Hùng Quân',
      "Đống Thiên Thu": 'Đống Thiên Thu',
      "Thâm Uyên Thánh Quân": 'Thâm Uyên Thánh Quân',
      "Linh Đế": 'Linh Đế',
      "Liệt Đế": 'Liệt Đế',
      "Trí Đế": 'Trí Đế',
      "Hóa Đế": 'Hóa Đế',
      "Ma Đế": 'Ma Đế',
      "Hắc Đế": 'Hắc Đế',
      "Phong Đế": 'Phong Đế',
      "Ban Hoàng": 'Ban Hoàng',
      "A Nhĩ Ba": 'A Nhĩ Ba',
      "Đường Tam": 'Đường Tam', "Hải Thần": 'Hải Thần',
      "Tiểu Vũ": 'Tiểu Vũ',
      "Lão Đường": 'Lão Đường',
      "Đường Hạo": 'Đường Hạo', "Vị Diện Chi Chủ": 'Vị Diện Chi Chủ',
      "A Ngân": 'A Ngân', "Sinh Mệnh Hạch Tâm": 'Sinh Mệnh Hạch Tâm',
      "Hủy Diệt Chi Thần": 'Hủy Diệt Chi Thần',
      "Sinh Mệnh Nữ Thần": 'Sinh Mệnh Nữ Thần', "Sinh Mệnh Chi Thần": 'Sinh Mệnh Nữ Thần',
      "Thiện Lương Chi Thần": 'Thiện Lương Chi Thần',
      "Tà Ác Chi Thần": 'Tà Ác Chi Thần',
      "Kim Long Vương": 'Kim Long Vương',
      "Đới Vũ Hạo": 'Đới Vũ Hạo', "Tình Tự Chi Thần": 'Đới Vũ Hạo',
      "Đường Vũ Đồng": 'Đường Vũ Đồng', "Điệp Thần": 'Điệp Thần',
      "Dung Niệm Băng": 'Dung Niệm Băng',
      "Chu Duy Thanh": 'Chu Duy Thanh', "Phá Hoại Chi Thần": 'Phá Hoại Chi Thần',
      "Đới Mộc Bạch": 'Đới Mộc Bạch', "Chiến Thần": 'Đới Mộc Bạch',
      "Chu Trúc Thanh": 'Chu Trúc Thanh', "Tốc Độ Chi Thần": 'Chu Trúc Thanh',
      "Áo Tư Tạp": 'Áo Tư Tạp', "Thực Thần": 'Thực Thần',
      "Ninh Vinh Vinh": 'Ninh Vinh Vinh', "Cửu Thải Thần Nữ": 'Ninh Vinh Vinh',
      "Mã Hồng Tuấn": 'Mã Hồng Tuấn', "Phượng Hoàng Chi Thần": 'Mã Hồng Tuấn',
      "Đới Hạo": 'Đới Hạo',
      "Hoắc Vân Nhi": 'Hoắc Vân Nhi',
      "Ngạo Mạn Chi Thần": 'Ngạo Mạn Chi Thần',
      "Tật Đố Chi Thần": 'Tật Đố Chi Thần',
      "Lãn Đọa Chi Thần": 'Lãn Đọa Chi Thần',
      "Tham Lam Chi Thần": 'Tham Lam Chi Thần',
      "Phẫn Nộ Chi Thần": 'Phẫn Nộ Chi Thần',
      "Sắc Dục Chi Thần": 'Sắc Dục Chi Thần',
      "Thủ lĩnh Hỏa Lê Tộc": 'Thủ lĩnh Hỏa Lê Tộc'
    };
  }

  var _npcs = [];
  var _ns = {};
  for (var _k in _nm) {
    if (_f.includes(_k)) {
      var _v = _nm[_k];
      if (!_ns[_v]) { _ns[_v] = true; _npcs.push(_v); }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 【Khu vực 4】Bảng ánh xạ thế lực/địa điểm + Kiểm tra
// ═══════════════════════════════════════════════════════════
if (typeof _places === 'undefined') {
  var _pm = {};

  if (_era === 'Đấu 1') {
    _pm = {
      "Võ Hồn Điện": 'Võ Hồn Điện', "Cung Phụng Điện": 'Võ Hồn Điện',
      "Thất Bảo Lưu Ly Tông": 'Thất Bảo Lưu Ly Tông',
      "Thiên Đấu Đế Quốc": 'Thiên Đấu Đế Quốc', "Thiên Đấu": 'Thiên Đấu Đế Quốc',
      "Tinh La Đế Quốc": 'Tinh La Đế Quốc', "Tinh La": 'Tinh La Đế Quốc',
      "Hạo Thiên Tông": 'Hạo Thiên Tông',
      "Gia tộc Lam Điện Bá Vương Long": 'Gia tộc Lam Điện Bá Vương Long',
      "Tượng Giáp Tông": 'Tượng Giáp Tông',
      "Đường Môn": 'Đường Môn',
      "Bạch Hổ Tông": 'Bạch Hổ Tông',
      "Phong Kiếm Tông": 'Phong Kiếm Tông',
      "Hỏa Báo Tông": 'Hỏa Báo Tông',
      "Phòng đấu giá Thiên Đấu": 'Phòng đấu giá Thiên Đấu',
      "Đại Đấu Hồn Trường": 'Đại Đấu Hồn Trường',
      "Nguyệt Hiên": 'Nguyệt Hiên',
      "Học viện Lam Bá": 'Học viện Lam Bá',
      "Học viện Sử Lai Khắc": 'Học viện Sử Lai Khắc',
      "Học viện Thần Phong": 'Học viện Thần Phong',
      "Học viện Thiên Thủy": 'Học viện Thiên Thủy',
      "Học viện Xí Hỏa": 'Học viện Xí Hỏa',
      "Học viện Tượng Giáp": 'Học viện Tượng Giáp',
      "Học viện Lôi Đình": 'Học viện Lôi Đình',
      "Học viện Dị Thú": 'Học viện Dị Thú',
      "Học viện Thực Vật": 'Học viện Thực Vật',
      "Học viện Thương Huy": 'Học viện Thương Huy',
      "Học viện Nặc Đinh": 'Học viện Nặc Đinh',
      "Sát Lục Chi Đô": 'Sát Lục Chi Đô',
      "Cực Bắc Chi Địa": 'Cực Bắc Chi Địa',
      "Rừng Lạc Nhật": 'Rừng Lạc Nhật',
      "Băng Hỏa Lưỡng Nghi Nhãn": 'Băng Hỏa Lưỡng Nghi Nhãn', "Tiên thảo": 'Băng Hỏa Lưỡng Nghi Nhãn',
      "Đảo Tử Trân Châu": 'Đảo Tử Trân Châu',
      "Rừng Lam Ngân": 'Rừng Lam Ngân', "Lam Ngân Vương": 'Rừng Lam Ngân',
      "Rừng Liệp Hồn": 'Rừng Liệp Hồn',
      "Tinh Đẩu Đại Sâm Lâm": 'Tinh Đẩu Đại Sâm Lâm', "Tinh Đẩu": 'Tinh Đẩu Đại Sâm Lâm',
      "Hải Thần Đảo": 'Hải Thần Đảo',
      "Thần Giới": 'Thần Giới', "Thần Vương": 'Thần Giới',
      "Canh Tân Thành": 'Canh Tân Thành và Hiệp hội Thợ rèn',
      "Hãn Hải Thành": 'Hãn Hải Thành',
      "Phá Chi Nhất Tộc": 'Phá Chi Nhất Tộc', "Dương Vô Địch": 'Phá Chi Nhất Tộc',
      "Mẫn Chi Nhất Tộc": 'Mẫn Chi Nhất Tộc', "Bạch Hạc": 'Mẫn Chi Nhất Tộc',
      "Ngự Chi Nhất Tộc": 'Ngự Chi Nhất Tộc', "Ngưu Cao": 'Ngự Chi Nhất Tộc',
      "Lực Chi Nhất Tộc": 'Lực Chi Nhất Tộc', "Thái Long": 'Lực Chi Nhất Tộc'
    };
  } else if (_era === 'Đấu 2') {
    _pm = {
      "Học viện Sử Lai Khắc": 'Học viện Sử Lai Khắc',
      "Sử Lai Khắc Thành": 'Sử Lai Khắc Thành',
      "Truyền Linh Tháp": 'Truyền Linh Tháp',
      "Đường Môn": 'Đường Môn',
      "Tinh Đẩu Đại Sâm Lâm": 'Tinh Đẩu Đại Sâm Lâm',
      "Cực Bắc Chi Địa": 'Cực Bắc Chi Địa',
      "Băng Hỏa Lưỡng Nghi Nhãn": 'Băng Hỏa Lưỡng Nghi Nhãn',
      "Thần Giới": 'Thần Giới',
      "Đấu Linh Đế Quốc": 'Đấu Linh Đế Quốc',
      "Thiên Hồn Đế Quốc": 'Thiên Hồn Đế Quốc',
      "Tinh La Đế Quốc": 'Tinh La Đế Quốc',
      "Nhật Nguyệt Đế Quốc": 'Nhật Nguyệt Đế Quốc',
      "Bản Thể Tông": 'Bản Thể Tông',
      "Cửu Bảo Lưu Ly Tông": 'Cửu Bảo Lưu Ly Tông',
      "Hạo Thiên Tông": 'Hạo Thiên Tông',
      "Thánh Linh Giáo": 'Thánh Linh Giáo',
      "Huyền Minh Tông": 'Huyền Minh Tông',
      "Thiên Long Môn": 'Thiên Long Môn',
      "Địa Long Môn": 'Địa Long Môn',
      "Băng Hải": 'Băng Hải',
      "Rừng Tà Ma": 'Rừng Tà Ma',
      "Càn Khôn Vấn Tình Cốc": 'Càn Khôn Vấn Tình Cốc',
      "Dãy núi Minh Đấu": 'Dãy núi Minh Đấu',
      "Học viện Hồn đạo sư Hoàng gia Nhật Nguyệt": 'Học viện Hồn đạo sư Hoàng gia Nhật Nguyệt',
      "Minh Đô": 'Minh Đô',
      "Minh Đức Đường": 'Minh Đức Đường',
      "Thiên Đấu Thành": 'Thiên Đấu Thành',
      "Đông Dương Thành": 'Đông Dương Thành',
      "Nhật Thăng Thành": 'Nhật Thăng Thành',
      "Phủ Bạch Hổ Công Tước": 'Phủ Bạch Hổ Công Tước'
    };
  } else if (_era === 'Đấu 3') {
    _pm = {
      "Học viện Sử Lai Khắc": 'Học viện Sử Lai Khắc', "Sử Lai Khắc": 'Học viện Sử Lai Khắc',
      "Truyền Linh Tháp": 'Truyền Linh Tháp',
      "Đường Môn": 'Đường Môn',
      "Chiến Thần Điện": 'Chiến Thần Điện',
      "Nhật Nguyệt Liên Bang": 'Nhật Nguyệt Liên Bang', "Liên Bang": 'Nhật Nguyệt Liên Bang',
      "Tinh La Đế Quốc": 'Tinh La Đế Quốc',
      "Đấu Linh Đế Quốc": 'Đấu Linh Đế Quốc', "Đấu Linh": 'Đấu Linh Đế Quốc',
      "Thánh Linh Giáo": 'Thánh Linh Giáo',
      "Huyết Thần Quân Đoàn": 'Huyết Thần Quân Đoàn',
      "Bản Thể Tông": 'Bản Thể Tông',
      "Học viện Đông Hải": 'Học viện Đông Hải',
      "Học viện Quái Vật": 'Học viện Quái Vật',
      "Hiệp hội Thợ rèn": 'Hiệp hội Thợ rèn',
      "Thâm Uyên Vị Diện": 'Thâm Uyên Vị Diện', "Thâm Uyên": 'Thâm Uyên Vị Diện',
      "Thần Giới": 'Thần Giới',
      "Tinh Đẩu Đại Sâm Lâm": 'Tinh Đẩu Đại Sâm Lâm',
      "Long Cốc": 'Long Cốc',
      "Gia tộc Nguyên Ân": 'Gia tộc Nguyên Ân',
      "Đảo Ma Quỷ": 'Đảo Ma Quỷ',
      "Hải Thần Đảo": 'Hải Thần Đảo',
      "Cực Bắc Chi Địa": 'Cực Bắc Chi Địa', "Cực Bắc": 'Cực Bắc Chi Địa',
      "Thiên Đấu Thành": 'Thiên Đấu Thành',
      "Minh Đô": 'Minh Đô',
      "Ngạo Lai Thành": 'Ngạo Lai Thành',
      "Hỏa Lê Tộc": 'Hỏa Lê Tộc',
      "Gia tộc Thiên Cổ": 'Gia tộc Thiên Cổ',
      "Gia tộc Thần Thánh Thiên Sứ": 'Gia tộc Thần Thánh Thiên Sứ', "Thần Thánh Thiên Sứ": 'Gia tộc Thần Thánh Thiên Sứ',
      "Gia tộc Lam Điện Bá Vương Long": 'Gia tộc Lam Điện Bá Vương Long', "Lam Điện Bá Vương Long": 'Gia tộc Lam Điện Bá Vương Long',
      "Hoàng tộc họ Đới": 'Hoàng tộc họ Đới', "Đới gia": 'Hoàng tộc họ Đới',
      "Đông Hải Thành": 'Đông Hải Thành',
      "Tinh La Thành": 'Tinh La Thành',
      "Thiên Hải Thành": 'Thiên Hải Thành',
      "Rừng Lạc Nhật": 'Rừng Lạc Nhật',
      "Bắc Hải Quân Đoàn": 'Bắc Hải Quân Đoàn',
      "Dãy núi Vô Tận": 'Dãy núi Vô Tận',
      "Anh Hùng Điện": 'Anh Hùng Điện',
      "Học viện Hồn đạo sư Hoàng gia Nhật Nguyệt": 'Học viện Hồn đạo sư Hoàng gia Nhật Nguyệt', "Học viện Hồn sư Hoàng gia Nhật Nguyệt": 'Học viện Hồn đạo sư Hoàng gia Nhật Nguyệt',
      "Tinh Đẩu Chiến Võng": 'Tinh Đẩu Chiến Võng',
      "Vĩnh Hằng Thiên Quốc": 'Vĩnh Hằng Thiên Quốc',
      "Huyết Hà Thí Thần Đại Trận": 'Huyết Hà Thí Thần Đại Trận',
      "Long Thần": 'Long Thần'
    };
  }

  var _places = [];
  var _ps = {};
  for (var _pk in _pm) {
    if (_f.includes(_pk)) {
      var _pv = _pm[_pk];
      if (!_ps[_pv]) { _ps[_pv] = true; _places.push(_pv); }
    }
  }
}
_%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 5】Tải thường trú (bao gồm lầu 0)                                %>
<%# ═══════════════════════════════════════════════════════════ %>
<%- await getwi(null, 'Quy tắc cốt lõi Đấu La Đại Lục') %>

<%_ if (!_isF0) { _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 6】Cục diện thế giới                                           %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_era === 'Đấu 1') { _%>
<%- await getwi(null, 'Đấu 1: Cục diện thế giới') %>
<%_ } else if (_era === 'Đấu 2') { _%>
<%- await getwi(null, 'Đấu 2: Cục diện thế giới') %>
<%_ } else if (_era === 'Đấu 3') { _%>
<%- await getwi(null, 'Đấu 3: Cục diện thế giới') %>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 7.5】Bảng khoảng chương                                       %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_era === 'Đấu 1') { _%>
<%- await getwi(null, 'Bảng khoảng chương Đấu 1') %>
<%_ } else if (_era === 'Đấu 2') { _%>
<%- await getwi(null, 'Bảng khoảng chương Đấu 2') %>
<%_ } else if (_era === 'Đấu 3') { _%>
<%- await getwi(null, 'Bảng khoảng chương Đấu 3') %>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 7】Tổng cương niên biểu                                           %>
<%# ═══════════════════════════════════════════════════════════ %>
<%- await getwi(null, _era + ': Tổng cương niên biểu cốt truyện (' + _period + ')') %>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 8】Chương                                               %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_chapter && _chapter !== 'Chờ khởi tạo') { _%>
<%- await getwi(null, _era + ': ' + _chapter) %>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 9A】Quy tắc thường trú (tải mỗi lần không phải lầu 0)                      %>
<%# ═══════════════════════════════════════════════════════════ %>
<%- await getwi(null, 'Quy tắc tương tác NPC') %>
<%- await getwi(null, 'Quy tắc diễn hóa cốt truyện') %>
<%- await getwi(null, 'Cơ chế trôi qua thời gian') %>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 9B】Quy tắc kích hoạt theo điều kiện (tải theo nhu cầu, không loại trừ lẫn nhau, có thể xếp chồng)            %>
<%# ═══════════════════════════════════════════════════════════ %>

<%_ if (_f.includes('Võ hồn thức tỉnh') || _f.includes('Nghi thức thức tỉnh') || _f.includes('Tiên thiên mãn hồn lực') || _f.includes('Song sinh võ hồn') || _f.includes('Phẩm chất võ hồn') || _f.includes('Kiểm tra võ hồn') || _f.includes('Võ hồn biến dị')) { _%>
<%- await getwi(null, 'Quy tắc đánh giá võ hồn') %>
<%_ } _%>

<%_ if (_f.includes('Dung hợp kỹ') || _f.includes('Võ hồn dung hợp')) { _%>
<%- await getwi(null, 'Quy tắc võ hồn dung hợp kỹ') %>
<%_ } _%>

<%_ if (_identity === 'Hồn thú' || _sType === 'Liệp hồn' || _f.includes('Hung thú') || _f.includes('Hồn thú mười vạn năm') || _f.includes('Hồn thú chi vương') || _f.includes('Thú triều') || _f.includes('Lãnh địa hồn thú')) { _%>
<%- await getwi(null, 'Thiết lập cơ bản hồn thú') %>
<%_ } _%><%_ if (_f.includes('Hiến tế') || _f.includes('Tự nguyện hiến tế') || _f.includes('Hồn thú hiến tế')) { _%>
<%- await getwi(null, 'Quy tắc hồn thú hiến tế') %>
<%_ } _%>

<%_ if (_f.includes('Hóa hình') || _f.includes('Nghi thức hóa hình') || _f.includes('Huyễn hóa nhân hình') || _f.includes('Hóa thành nhân hình')) { _%>
<%- await getwi(null, 'Quy tắc hồn thú hóa hình') %>
<%_ } _%>

<%_ if (_soulLevel >= 95 || _f.includes('Thành thần') || _f.includes('Thần khảo') || _f.includes('Thần vị') || _f.includes('Thần chỉ') || _f.includes('Cực Hạn Đấu La') || _f.includes('Trăm cấp') || _f.includes('Phong thần')) { _%>
<%- await getwi(null, 'Quy tắc thành thần') %>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 10】Quy tắc cảnh (loại trừ lẫn nhau, chỉ tải một loại)                        %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ var _sr = false; _%>

<%_ if (!_sr && (_sType === 'Chiến đấu' || _sType === 'Thi đấu' || _sType === 'Khảo hạch' || _f.includes('Chiến đấu') || _f.includes('Phóng thích hồn kỹ') || _f.includes('Tấn công') || _f.includes('Giao thủ') || _f.includes('Hồn hoàn sáng lên'))) { _%>
<%- await getwi(null, 'Hướng dẫn miêu tả chiến đấu') %>
<%_ _sr = true; } _%>

<%_ if (!_sr && (_sType === 'Liệp hồn' || _f.includes('Liệp hồn') || _f.includes('Săn giết hồn thú') || _f.includes('Hấp thu hồn hoàn') || _f.includes('Dung hợp hồn hoàn'))) { _%>
<%- await getwi(null, 'Quy tắc tạo hồn thú') %>
<%- await getwi(null, 'Quy tắc tạo hồn kỹ') %>
<%_ _sr = true; } _%>

<%_ if (!_sr && (_sType === 'Mua sắm' || _sType === 'Đấu giá' || _f.includes('Đấu giá') || _f.includes('Mua') || _f.includes('Giao dịch') || _f.includes('Kim hồn tệ') || _f.includes('Cửa hàng'))) { _%>
<%- await getwi(null, 'Hệ thống kinh tế') %>
<%_ _sr = true; } _%>

<%_ if (!_sr && _sType === 'Thân mật') { _%>
<%- await getwi(null, 'Quy tắc NSFW') %>
<%_ _sr = true; } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 11】Quy tắc đại hội/sự kiện (kích hoạt bằng từ khóa, không loại trừ lẫn nhau với khu vực 10)          %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_era === 'Đấu 1') { _%>
<%_ if (_f.includes('Đại hội tinh anh') || _f.includes('Học viện hồn sư cao cấp toàn đại lục')) { _%>
<%- await getwi(null, 'Đấu 1: Quy tắc đại hội tinh anh') %>
<%_ } _%>
<%_ } _%>

<%_ if (_era === 'Đấu 2') { _%>
<%_ if (_f.includes('Khảo hạch tân sinh')) { _%>
<%- await getwi(null, 'Đấu 2: Quy tắc khảo hạch tân sinh') %>
<%_ } _%>
<%_ if (_f.includes('Hải Thần Duyên')) { _%>
<%- await getwi(null, 'Đấu 2: Quy tắc Hải Thần Duyên') %>
<%_ } _%>
<%_ if (_f.includes('Đại hội tinh anh') || _f.includes('Hồn sư cao cấp thanh niên')) { _%>
<%- await getwi(null, 'Đấu 2: Quy tắc Đại hội tinh anh hồn sư cao cấp thanh niên toàn đại lục') %>
<%_ } _%>
<%_ if (_f.includes('Đại hội đấu hồn') || _f.includes('Đấu hồn học viện hồn sư cao cấp')) { _%>
<%- await getwi(null, 'Đấu 2: Quy tắc Đại hội đấu hồn học viện hồn sư cao cấp toàn đại lục') %>
<%_ } _%>
<%_ } _%>

<%_ if (_era === 'Đấu 3') { _%>
<%_ if (_f.includes('Đại hội tinh anh') || _f.includes('Hồn sư cao cấp thanh niên') || _f.includes('Thanh niên toàn đại lục')) { _%>
<%- await getwi(null, 'Đấu 3: Đại hội Tinh La') %>
<%_ } _%>
<%_ if (_f.includes('Khảo hạch nhập học') || _f.includes('Thi lại') || _f.includes('Khảo hạch Sử Lai Khắc')) { _%>
<%- await getwi(null, 'Đấu 3: Khảo hạch nhập học Sử Lai Khắc') %>
<%_ } _%>
<%_ if (_f.includes('Tỷ võ chiêu thân') || _f.includes('Đại hội chiêu thân')) { _%>
<%- await getwi(null, 'Đấu 3: Tỷ võ chiêu thân') %>
<%_ } _%>
<%_ if (_f.includes('Ngũ Thần Chi Quyết')) { _%>
<%- await getwi(null, 'Đấu 3: Ngũ Thần Chi Quyết') %>
<%_ } _%>
<%_ if (_f.includes('Tinh Đẩu Chiến Võng') || _f.includes('Song quan vương')) { _%>
<%- await getwi(null, 'Đấu 3: Thể thức thi đấu Tinh Đẩu Chiến Võng') %>
<%_ } _%>
<%_ if (_f.includes('Đánh cược') || _f.includes('Đánh cược phục hưng') || _f.includes('Học viện Truyền Linh')) { _%>
<%- await getwi(null, 'Đấu 3: Đánh cược phục hưng Sử Lai Khắc') %>
<%_ } _%>
<%_ if (_f.includes('Hải Thần Duyên') || _f.includes('Đại hội xem mắt')) { _%>
<%- await getwi(null, 'Đấu 3: Quy tắc xem mắt Hải Thần') %>
<%_ } _%>
<%_ if (_f.includes('Chín ván thắng năm') || _f.includes('Đánh cược Thâm Uyên') || _f.includes('Đánh cược lôi đài')) { _%>
<%- await getwi(null, 'Đấu 3: Đánh cược Thâm Uyên') %>
<%_ } _%>
<%_ if (_f.includes('Thi cuối kỳ') || _f.includes('Khảo hạch cuối kỳ') || _f.includes('Mười lăm ngày')) { _%>
<%- await getwi(null, 'Đấu 3: Quy tắc khảo hạch cuối kỳ Sử Lai Khắc') %>
<%_ } _%>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 12】Thiết lập độc quyền Đấu 2                                      %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_era === 'Đấu 2') { _%>
<%- await getwi(null, 'Đấu 2: Thiết lập hồn đạo sư') %>

<%_ if (_f.includes('Hồn đạo khí') || _f.includes('Hồn đạo pháo') || _f.includes('Hồn đạo nỗ') || _f.includes('Hồn đạo liệt xa')) { _%>
<%- await getwi(null, 'Đấu 2: Thiết lập hồn đạo khí') %>
<%_ } _%>

<%_ if (_f.includes('Hồn linh') || _f.includes('Võ hồn chân thân')) { _%>
<%- await getwi(null, 'Đấu 2: Thiết lập cơ bản hồn linh') %>
<%_ } _%>

<%_ if (_f.includes('Hồn hạch') || _f.includes('Ngưng tụ hồn hạch')) { _%>
<%- await getwi(null, 'Quy tắc ngưng tụ hồn hạch') %>
<%_ } _%>

<%_ if (_f.includes('Vong linh') || _f.includes('Bán vị diện') || _f.includes('Ma pháp Vong Linh')) { _%>
<%- await getwi(null, 'Đấu 2: Bán vị diện Vong Linh và Ma pháp Vong Linh') %>
<%_ } _%>

<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 12B】Thiết lập độc quyền Đấu 3                                     %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_era === 'Đấu 3') { _%>

<%_ if (_f.includes('Hồn linh') || _f.includes('Hồn linh nhân tạo') || _f.includes('Hồn hoàn')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập hồn linh') %>
<%_ } _%>

<%_ if (_f.includes('Hồn lực') || _f.includes('Hồn hoàn') || _f.includes('Phong Hào Đấu La') || _f.includes('Hồn sư') || _f.includes('Hồn Vương') || _f.includes('Hồn Đế') || _f.includes('Hồn Thánh') || _f.includes('Hồn Đấu La')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập cấp bậc hồn sư') %>
<%_ } _%>

<%_ if (_f.includes('Tinh thần lực') || _f.includes('Linh Hải Cảnh') || _f.includes('Linh Vực Cảnh') || _f.includes('Linh Uyên Cảnh') || _f.includes('Thần Nguyên Cảnh') || _f.includes('Minh tưởng')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập tinh thần lực') %>
<%_ } _%>

<%_ if (_f.includes('Huyết mạch') || _f.includes('Kim Long Vương') || _f.includes('Ngân Long Vương') || _f.includes('Long Thần Biến') || _f.includes('Phong ấn') || _f.includes('Khí huyết')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập huyết mạch') %>
<%_ } _%>

<%_ if (_f.includes('Rèn') || _f.includes('Thợ rèn') || _f.includes('Thiên Đoán') || _f.includes('Linh Đoán') || _f.includes('Hồn Đoán') || _f.includes('Thiên Đoán') || _f.includes('Bách Đoán') || _f.includes('Thánh Tượng') || _f.includes('Thần Tượng') || _f.includes('Loạn Phi Phong')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập thợ rèn') %>
<%_ } _%>

<%_ if (_f.includes('Đấu khải') || _f.includes('Nhất tự đấu khải') || _f.includes('Nhị tự đấu khải') || _f.includes('Tam tự đấu khải') || _f.includes('Tứ tự đấu khải') || _f.includes('Kim Long Nguyệt Ngữ') || _f.includes('Ngân Long Vũ Lân')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập đấu khải') %>
<%_ } _%>

<%_ if (_f.includes('Cơ giáp') || _f.includes('Cơ giáp sư') || _f.includes('Cấp trắng') || _f.includes('Cấp vàng') || _f.includes('Cấp tím') || _f.includes('Cấp đen') || _f.includes('Cấp đỏ')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập cơ giáp') %>
<%_ } _%>

<%_ if (_f.includes('Hồn đạo khí') || _f.includes('Hồn đạo pháo') || _f.includes('Định trang hồn đạo pháo đạn') || _f.includes('Cấp Thí Thần') || _f.includes('Hồn đạo liệt xa')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập hồn đạo khí') %>
<%_ } _%>

<%_ if (_f.includes('Thăng Linh Đài') || _f.includes('Kỳ bạo động') || _f.includes('Hồn thú ảo')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập Thăng Linh Đài') %>
<%_ } _%>

<%_ if (_f.includes('Lĩnh vực') || _f.includes('Lĩnh vực đấu khải') || _f.includes('Lĩnh vực võ hồn')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập lĩnh vực') %>
<%_ } _%>

<%_ if (_f.includes('Thiết kế cơ giáp') || _f.includes('Nhà thiết kế') || _f.includes('Bản vẽ thiết kế')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập nhà thiết kế cơ giáp') %>
<%_ } _%>

<%_ if (_f.includes('Chế tạo cơ giáp') || _f.includes('Thợ chế tạo') || _f.includes('Điêu khắc pháp trận')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập thợ chế tạo cơ giáp') %>
<%_ } _%>

<%_ if (_f.includes('Sửa chữa cơ giáp') || _f.includes('Thợ sửa chữa') || _f.includes('Tiếp nối pháp trận')) { _%>
<%- await getwi(null, 'Đấu 3: Thiết lập thợ sửa chữa cơ giáp') %>
<%_ } _%>

<%_ if (_f.includes('Liên bang tệ') || _f.includes('Điểm cống hiến') || _f.includes('Đấu giá') || _f.includes('Mua') || _f.includes('Giao dịch')) { _%>
<%- await getwi(null, 'Đấu 3: Hệ thống kinh tế') %>
<%_ } _%>

<%_ if (_f.includes('Hồn cốt') || _f.includes('Ngoại phụ hồn cốt') || _f.includes('Đầu cốt') || _f.includes('Khu cán cốt')) { _%>
<%- await getwi(null, 'Thiết lập hồn cốt Đấu La') %>
<%_ } _%>

<%_ if (_f.includes('Võ hồn biến dị') || _f.includes('Biến dị võ hồn')) { _%>
<%- await getwi(null, 'Quy tắc võ hồn biến dị') %>
<%_ } _%>

<%_ if (_f.includes('Thức tỉnh lần hai') || _f.includes('Võ hồn tiến hóa') || _f.includes('Lam Ngân Hoàng')) { _%>
<%- await getwi(null, 'Quy tắc võ hồn thức tỉnh lần hai') %>
<%_ } _%>

<%_ if (_soulLevel >= 95 || _f.includes('Thành thần') || _f.includes('Thần vị') || _f.includes('Thần chỉ') || _f.includes('Thần Giới') || _f.includes('Cực Hạn Đấu La') || _f.includes('Chuẩn thần') || _f.includes('Bán thần') || _f.includes('Siêu thần khí')) { _%>
<%- await getwi(null, 'Thiết lập cấp bậc trên thần cấp') %>
<%_ } _%>

<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khu vực 13】Tải thế lực/địa điểm                                     %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_places && _places.length > 0) { _%><%_ for (var _p = 0; _p < _places.length; _p++) { _%>
<%- await getwi(null, _era + ': ' + _places[_p]) %>
<%_ } _%>
<%_ } _%>

<%# ═══════════════════════════════════════════════════════════ %>
<%# 【Khối 14】Tải NPC                                           %>
<%# ═══════════════════════════════════════════════════════════ %>
<%_ if (_npcs && _npcs.length > 0) { _%>
<%_ for (var _n = 0; _n < _npcs.length; _n++) { _%>
<%- await getwi(null, _era + ': ' + _npcs[_n]) %>
<%_ } _%>
<%_ } _%>

<%_ } _%>