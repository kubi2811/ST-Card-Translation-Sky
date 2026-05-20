<%_
(function() {
  var statData = getvar('stat_data');
  if (!statData) {
    print('{}');
    return;
  }

  var era = (statData['Trạng thái thế giới'] && statData['Trạng thái thế giới']['Thời đại hiện tại']) || 'Đấu 1';
  var sType = (statData['Trạng thái thế giới'] && statData['Trạng thái thế giới']['Loại cảnh hiện tại']) || 'Hàng ngày';

  var isCombat = (sType === 'Chiến đấu' || sType === 'Thi đấu' || sType === 'Khảo hạch');
  var isHunt = (sType === 'Liệp hồn');
  var isTrain = (sType === 'Tu luyện');
  var isIntimate = (sType === 'Thân mật');
  var isShop = (sType === 'Mua sắm' || sType === 'Đấu giá');

  /* ═══ Xây dựng đối tượng đầu ra ═══ */
  var output = {};

  /* ─── Trạng thái thế giới (Luôn xuất ra) ─── */
  if (statData['Trạng thái thế giới']) {
    output['Trạng thái thế giới'] = {
      'Thời đại hiện tại': statData['Trạng thái thế giới']['Thời đại hiện tại'],
      'Ngày tháng hiện tại': statData['Trạng thái thế giới']['Ngày tháng hiện tại'],
      'Khu vực hiện tại': statData['Trạng thái thế giới']['Khu vực hiện tại'],
      'Cảnh hiện tại': statData['Trạng thái thế giới']['Cảnh hiện tại'],
      'Loại cảnh hiện tại': statData['Trạng thái thế giới']['Loại cảnh hiện tại'],
      'Chương cốt truyện': statData['Trạng thái thế giới']['Chương cốt truyện'],
      'Thời kỳ niên biểu': statData['Trạng thái thế giới']['Thời kỳ niên biểu']
    };
  }

  /* ─── Thông tin người chơi ─── */
  if (statData['Người chơi']) {
    var player = statData['Người chơi'];
    var pOut = {};

    /* Thông tin cơ bản (Luôn xuất ra) */
    if (player['Thông tin cơ bản']) {
      pOut['Thông tin cơ bản'] = {
        'Họ tên': player['Thông tin cơ bản']['Họ tên'],
        'Thân phận': player['Thông tin cơ bản']['Thân phận'],
        'Ngoại hình': player['Thông tin cơ bản']['Ngoại hình'],
        'Danh hiệu hồn sư': player['Thông tin cơ bản']['Danh hiệu hồn sư']
      };
      /* Bổ sung theo thời đại */
      if (era === 'Đấu 2' && player['Thông tin cơ bản']['Cấp bậc hồn đạo sư'] && player['Thông tin cơ bản']['Cấp bậc hồn đạo sư'] !== 'Phi hồn đạo sư') {
        pOut['Thông tin cơ bản']['Cấp bậc hồn đạo sư'] = player['Thông tin cơ bản']['Cấp bậc hồn đạo sư'];
      }
      if (player['Thông tin cơ bản']['Phong hào'] && player['Thông tin cơ bản']['Phong hào'] !== 'Không') {
        pOut['Thông tin cơ bản']['Phong hào'] = player['Thông tin cơ bản']['Phong hào'];
      }
    }

    /* Cấp bậc hồn lực (Luôn xuất ra) */
    if (player['Trạng thái tu luyện']) {
      pOut['Cấp bậc hồn lực'] = player['Trạng thái tu luyện']['Cấp bậc hồn lực'];
      /* Khi chiến đấu/liệp hồn thì xuất thêm phần trăm hồn lực */
      if (isCombat || isHunt) {
        pOut['Phần trăm hồn lực hiện tại'] = player['Trạng thái tu luyện']['Phần trăm hồn lực hiện tại'];
      }
    }

    /* Thông tin võ hồn */
    if (player['Thông tin võ hồn'] && typeof player['Thông tin võ hồn'] === 'object') {
      if (isCombat || isHunt) {
        /* Chiến đấu/Liệp hồn: Xuất toàn bộ thông tin võ hồn */
        pOut['Thông tin võ hồn'] = player['Thông tin võ hồn'];
      } else {
        /* Cảnh khác: Chỉ xuất Tên võ hồn + Phẩm chất */
        var wSimple = {};
        for (var wn in player['Thông tin võ hồn']) {
          if (Object.hasOwnProperty.call(player['Thông tin võ hồn'], wn)) {
            wSimple[wn] = { 'Phẩm chất': player['Thông tin võ hồn'][wn]['Phẩm chất'] };
          }
        }
        if (Object.keys(wSimple).length > 0) {
          pOut['Thông tin võ hồn'] = wSimple;
        }
      }
    }

    /* Dành riêng cho chiến đấu: Hồn cốt, Dung hợp kỹ, Đấu khải... */
    if (isCombat) {
      if (player['Hồn cốt thông thường'] && Object.keys(player['Hồn cốt thông thường']).length > 0) {
        pOut['Hồn cốt thông thường'] = player['Hồn cốt thông thường'];
      }
      if (player['Ngoại phụ hồn cốt'] && Object.keys(player['Ngoại phụ hồn cốt']).length > 0) {
        pOut['Ngoại phụ hồn cốt'] = player['Ngoại phụ hồn cốt'];
      }
      if (player['Võ hồn dung hợp kỹ'] && Object.keys(player['Võ hồn dung hợp kỹ']).length > 0) {
        pOut['Võ hồn dung hợp kỹ'] = player['Võ hồn dung hợp kỹ'];
      }
      /* ★ Tự thể võ hồn dung hợp kỹ (Nội bộ người chơi) ★ */
      if (player['Tự thể võ hồn dung hợp kỹ'] && Object.keys(player['Tự thể võ hồn dung hợp kỹ']).length > 0) {
        pOut['Tự thể võ hồn dung hợp kỹ'] = player['Tự thể võ hồn dung hợp kỹ'];
      }
      if (player['Hồn hạch'] && Object.keys(player['Hồn hạch']).length > 0) {
        pOut['Hồn hạch'] = player['Hồn hạch'];
      }
      /* Đấu 3 chiến đấu xuất thêm Đấu khải */
      if (era === 'Đấu 3' && player['Thông tin đấu khải'] && player['Thông tin đấu khải']['Cấp bậc đấu khải'] !== 'Không') {
        pOut['Thông tin đấu khải'] = {
          'Tên đấu khải': player['Thông tin đấu khải']['Tên đấu khải'],
          'Cấp bậc đấu khải': player['Thông tin đấu khải']['Cấp bậc đấu khải']
        };
      }
    }

    /* Dành riêng cho tu luyện: Công pháp, Tinh thần lực */
    if (isTrain) {
      if (player['Công pháp'] && Object.keys(player['Công pháp']).length > 0) {
        pOut['Công pháp'] = player['Công pháp'];
      }
      /* Tinh thần lực Đấu 3 */
      if (era === 'Đấu 3' && player['Tinh thần lực']) {
        pOut['Tinh thần lực'] = player['Tinh thần lực'];
      }
    }

    /* Đấu 3: Cảnh giới tinh thần lực và Cảnh giới rèn (Không phải giá trị mặc định thì luôn xuất) */
    if (era === 'Đấu 3') {
      if (player['Tinh thần lực'] && player['Tinh thần lực']['Cảnh giới tinh thần lực'] !== 'Không áp dụng' && !isTrain) {
        pOut['Cảnh giới tinh thần lực'] = player['Tinh thần lực']['Cảnh giới tinh thần lực'];
      }
      if (player['Thông tin rèn'] && player['Thông tin rèn']['Cảnh giới rèn'] !== 'Không áp dụng') {
        pOut['Cảnh giới rèn'] = player['Thông tin rèn']['Cảnh giới rèn'];
      }
      if (player['Thông tin đấu khải'] && player['Thông tin đấu khải']['Cấp bậc đấu khải'] !== 'Không' && !isCombat) {
        pOut['Cấp bậc đấu khải'] = player['Thông tin đấu khải']['Cấp bậc đấu khải'];
      }
    }

    /* Tiền tài (Luôn xuất ra, lọc theo thời đại) */
    if (player['Tiền tài']) {
      if (era === 'Đấu 1' || era === 'Đấu 2') {
        pOut['Tiền tài'] = {
          'Kim hồn tệ': player['Tiền tài']['Kim hồn tệ'],
          'Ngân hồn tệ': player['Tiền tài']['Ngân hồn tệ'],
          'Đồng hồn tệ': player['Tiền tài']['Đồng hồn tệ']
        };
      } else if (era === 'Đấu 3') {
        pOut['Tiền tài'] = {
          'Liên bang tệ': player['Tiền tài']['Liên bang tệ'],
          'Điểm cống hiến': player['Tiền tài']['Điểm cống hiến']
        };
      }
    }

    /* Túi đồ (Xuất khi không trống) */
    if (player['Túi đồ'] && Object.keys(player['Túi đồ']).length > 0) {
      pOut['Túi đồ'] = player['Túi đồ'];
    }

    output['Người chơi'] = pOut;
  }

  /* ─── NPC có mặt ─── */
  if (statData['Danh sách NPC'] && typeof statData['Danh sách NPC'] === 'object') {
    var npcOut = {};

    for (var npcName in statData['Danh sách NPC']) {
      if (!Object.hasOwnProperty.call(statData['Danh sách NPC'], npcName)) continue;
      var npc = statData['Danh sách NPC'][npcName];
      if (!npc || !npc['Thông tin cơ bản'] || npc['Thông tin cơ bản']['Có mặt hay không'] !== true) continue;

      var n = {};

      /* Thông tin cơ bản (Luôn xuất ra) */
      n['Thân phận'] = npc['Thông tin cơ bản']['Thân phận'];
      n['Hành động hiện tại'] = npc['Thông tin cơ bản']['Hành động hiện tại'];
      n['Ngoại hình'] = npc['Thông tin cơ bản']['Ngoại hình'];

      /* Thông tin quan hệ (Luôn xuất ra) */
      if (npc['Danh sách quan hệ']) {
        n['Trạng thái quan hệ với người chơi'] = npc['Danh sách quan hệ']['Trạng thái quan hệ với người chơi'];
        if (npc['Danh sách quan hệ']['Giai đoạn quan hệ']) {
          n['Giai đoạn quan hệ'] = npc['Danh sách quan hệ']['Giai đoạn quan hệ'];
        }
        if (npc['Danh sách quan hệ']['Cách xưng hô với người chơi']) {
          n['Cách xưng hô với người chơi'] = npc['Danh sách quan hệ']['Cách xưng hô với người chơi'];
        }
      }

      /* Rút gọn trang phục (Luôn xuất ra phần thân trên + thân dưới) */
      if (npc['Hồ sơ bí mật'] && npc['Hồ sơ bí mật']['Trang phục']) {
        var sf = npc['Hồ sơ bí mật']['Trang phục'];
        var costumeStr = '';
        if (sf['Thân trên']) costumeStr += sf['Thân trên'];
        if (sf['Thân dưới']) costumeStr += (costumeStr ? '、' : '') + sf['Thân dưới'];
        if (costumeStr) n['Trang phục'] = costumeStr;
      }

      /* Khi Chiến đấu/Liệp hồn/Thi đấu/Khảo hạch: Xuất hồn lực và võ hồn */
      if (isCombat || isHunt) {
        n['Cấp bậc hồn lực'] = npc['Thông tin cơ bản']['Cấp bậc hồn lực'];
        n['Danh hiệu hồn sư'] = npc['Thông tin cơ bản']['Danh hiệu hồn sư'];
        if (npc['Thông tin cơ bản']['Phong hào'] && npc['Thông tin cơ bản']['Phong hào'] !== 'Không') {
          n['Phong hào'] = npc['Thông tin cơ bản']['Phong hào'];
        }
        if (npc['Thông tin võ hồn'] && typeof npc['Thông tin võ hồn'] === 'object') {
          n['Thông tin võ hồn'] = npc['Thông tin võ hồn'];
        }
      }

      /* Cảnh thân mật: Xuất toàn bộ hồ sơ bí mật */
      if (isIntimate && npc['Hồ sơ bí mật']) {
        n['Hồ sơ bí mật'] = npc['Hồ sơ bí mật'];
        delete n['Trang phục'];
      }

      npcOut[npcName] = n;
    }

    if (Object.keys(npcOut).length > 0) {
      output['NPC có mặt'] = npcOut;
    }
  }

  /* ─── NPC Hồn thú (Trích xuất ngắn gọn) ─── */
  if (statData['NPC hồn thú'] && typeof statData['NPC hồn thú'] === 'object') {
    var beastOut = {};
    for (var bName in statData['NPC hồn thú']) {
      if (!Object.hasOwnProperty.call(statData['NPC hồn thú'], bName)) continue;
      var beast = statData['NPC hồn thú'][bName];
      if (!beast || !beast['Thông tin cơ bản']) continue;
      beastOut[bName] = {
        'Chủng tộc': beast['Thông tin cơ bản']['Thông tin chủng tộc'],
        'Niên hạn': beast['Thông tin cơ bản']['Niên hạn'],
        'Hành động': beast['Thông tin cơ bản']['Hành động hiện tại'],
        'Thái độ': beast['Thái độ với người chơi']
      };
    }
    if (Object.keys(beastOut).length > 0) {
      output['NPC hồn thú'] = beastOut;
    }
  }

  print(JSON.stringify(output, null, 2));
})();
_%>