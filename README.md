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

1. Tạo hai database D1 bằng `pnpm exec wrangler d1 create cloudmini-notepad` và `pnpm exec wrangler d1 create cloudmini-notepad-preview`. Điền ID tương ứng vào `wrangler.jsonc`. Điền lại ID production trong `worker/wrangler.jsonc`.
2. Áp dụng migration bằng `pnpm exec wrangler d1 migrations apply DB --remote` và `pnpm exec wrangler d1 migrations apply DB --remote --env preview`.
3. Pages project `cloudmini-notepad` đã được tạo bằng Direct Upload tại `https://cloudmini-notepad.pages.dev`. Sau mỗi lần thay đổi, chạy `pnpm build` rồi `pnpm exec wrangler pages deploy dist --project-name cloudmini-notepad --branch main`. Pages Functions nằm trong `functions/`. GitHub là kho mã nguồn; push Git chưa tự deploy Pages.
4. Dùng Cloudflare Access bảo vệ `/admin`, `/admin/*`, `/api/admin/*` bằng cùng ứng dụng Access và giới hạn email quản trị. Trong Pages, đặt `ACCESS_TEAM_DOMAIN` (URL HTTPS của team Access) và `ACCESS_AUD` (Application Audience). API sẽ từ chối quản trị khi JWT thiếu hoặc không hợp lệ, kể cả trên hostname khác.
5. Worker dọn ghi chú hết hạn đã deploy. Khi thay đổi Worker, chạy `pnpm exec wrangler deploy --config worker/wrangler.jsonc`. Worker dọn tối đa 1.000 ghi chú mỗi nửa giờ. Ghi chú hết hạn đã bị từ chối ở API trước lúc dọn.
6. Trước khi mở site công khai, cấu hình giới hạn tần suất cho POST `/api/notes` và POST `/api/notes/*/unlock` bằng WAF/rate limiting theo IP phù hợp gói Cloudflare. Thử trên hostname tạm với D1 preview trước khi chuyển DNS.

## Dữ liệu VPS hiện tại

Chưa nhập dữ liệu production. Sao lưu MySQL, kiểm tra ghi chú còn hạn và nhập thử vào D1 preview trước khi đổi DNS. Ánh xạ ID cũ thành slug, giữ thời điểm hết hạn và dùng bộ đếm lượt xem từ note_metadata. Ghi chú cũ không có thông tin xác nhận người tạo nên cấp quyền sửa bằng quy trình riêng. Kiểm tra định dạng hash Werkzeug trước khi nhập ghi chú có mật khẩu. Nếu chưa hỗ trợ hash đó, giữ bản ghi trong bản sao lưu để xử lý riêng, không công khai nội dung.

Bản nháp chưa đồng bộ lưu trong sessionStorage của tab. Link sửa chứa khóa sau dấu #, trình duyệt không gửi fragment trong URL HTTP. Khóa được gửi trong header khi gọi API và chỉ lưu hash trên D1. Hãy lưu riêng link sửa nếu cần mở trên thiết bị khác.
