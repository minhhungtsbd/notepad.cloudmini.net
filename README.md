# notepad.cloudmini.net

Notepad Cloudmini dùng React, Vite, Cloudflare Pages Functions và D1. Có link xem và link chỉnh sửa riêng, mật khẩu theo ghi chú, tự lưu có kiểm tra phiên bản, xem Markdown/Raw/Code, nhập/xuất file và hết hạn sau 30 ngày. Liên kết cũ của một ghi chú vẫn trỏ đến ghi chú đó sau khi đổi URL.

## Chạy trên máy

Cần Node.js 22+ và pnpm. D1 local lưu trong `.wrangler/`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

## Cloudflare

1. Database D1 production là `cloudmini-notepad`; ID nằm trong `wrangler.jsonc` và `worker/wrangler.jsonc`.
2. Áp dụng migration bằng `pnpm exec wrangler d1 migrations apply DB --remote`.
3. Pages project `cloudmini-notepad` dùng Direct Upload, miền chính là `https://notepad.cloudmini.net`. Sau mỗi lần thay đổi, chạy `pnpm build` rồi `pnpm exec wrangler pages deploy dist --project-name cloudmini-notepad --branch main`. Pages Functions nằm trong `functions/`. GitHub là kho mã nguồn; push Git chưa tự deploy Pages. Các URL `pages.dev` chuyển về miền chính.
4. Trang `/admin` hiển thị tổng số ghi chú, lượt xem, ghi chú hết hạn và không hoạt động; có bộ lọc, đổi hạn, xóa từng ghi chú và nút dọn ngay. Cloudflare Access bảo vệ `/admin` và `/api/admin/*`; chính sách cho phép email `support@cloudmini.net`. Pages production đã đặt `ACCESS_TEAM_DOMAIN` và `ACCESS_AUD` theo ứng dụng Access. API từ chối quản trị khi JWT thiếu hoặc không hợp lệ.
5. Worker dọn ghi chú hết hạn hoặc không có lượt xem/cập nhật trong 21 ngày. Khi thay đổi Worker, chạy `pnpm exec wrangler deploy --config worker/wrangler.jsonc`. Worker dọn tối đa 1.000 ghi chú mỗi nửa giờ. Mở ghi chú bằng link xem hoặc link sửa đều cập nhật mốc hoạt động; chỉ lượt xem bằng link xem tăng bộ đếm. Ghi chú hết hạn đã bị từ chối ở API trước lúc dọn.
6. Cấu hình giới hạn tần suất cho POST `/api/notes` và POST `/api/notes/*/unlock` bằng WAF/rate limiting theo IP phù hợp gói Cloudflare.

## Dữ liệu VPS cũ

Ứng dụng và dữ liệu Notepad trên VPS cũ đã được xóa theo yêu cầu, không sao lưu và không nhập sang D1. Liên kết ghi chú của hệ thống cũ không hoạt động trên trang mới.

Bản nháp chưa đồng bộ lưu trong sessionStorage của tab. Link sửa chứa khóa sau dấu #, trình duyệt không gửi fragment trong URL HTTP. Khóa được gửi trong header khi gọi API và chỉ lưu hash trên D1. Hãy lưu riêng link sửa nếu cần mở trên thiết bị khác.
