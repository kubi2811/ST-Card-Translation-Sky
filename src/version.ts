// ─── App version ───
// BUMP `APP_VERSION` on every fix so builds are distinguishable in the UI (shown in the
// sidebar header). Use the patch number for small fixes; keep `APP_VERSION_NOTE` to a one-line
// summary of the most recent change (shown on hover).
export const APP_VERSION = '2.7.6';
export const APP_VERSION_NOTE = "Bug 75+76: (75a) MVU het loi 变量更新失败 — Auto Creator truoc gio chi tao 3 entry he thong trong khi card MVU that co 5; nay them du entry DINH DANG DAU RA (khoi <UpdateVariable> phai co dung 2 the con <Analysis> + <JSONPatch>, de tran mang JSON la MVU parse khong ra). (75b) Nut trong Opening Form bam duoc roi — ham nam trong <script type=module> khong bao gio len window ma nut lai goi bang onclick= inline, nay tu dong xuat handler ra global. (75c) Kiem tra tong the het de dai: them kiem hop dong MVU, kiem nut chet, kiem script render rong; prompt AI review doi tu 'nhan xet ngan gon' sang phan xu hoai nghi co tieu chi truot. (76) Nut xanh 'Dong nhat ten bien MVU' khong con TU TAY tao xung dot: bo gom cum theo khoang cach Levenshtein tren ban dich (Bach Thuoc vs Xich Thuoc lech 2 ky tu la bi gop!), chi gom khi NGUON la cung mot bien.";
