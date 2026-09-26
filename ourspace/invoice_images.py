import base64
import binascii
import re

from .errors import ApiError


MAX_IMAGE_BYTES = 4_000_000
MAX_OCR_BODY_BYTES = 5_400_000


def decode_invoice_image(image) -> tuple[str, bytes]:
    if not isinstance(image, str) or len(image) > MAX_OCR_BODY_BYTES:
        raise ApiError("請上傳不超過 4 MB 的 JPEG、PNG 或 WebP 單據照片")
    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", image)
    if not match:
        raise ApiError("請上傳 JPEG、PNG 或 WebP 單據照片")
    try:
        decoded = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ApiError("照片資料無效") from exc
    signatures = {
        "jpeg": decoded.startswith(b"\xff\xd8\xff"),
        "png": decoded.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": decoded.startswith(b"RIFF") and decoded[8:12] == b"WEBP",
    }
    if not signatures[match[1]] or len(decoded) > MAX_IMAGE_BYTES:
        raise ApiError("照片格式無效或超過 4 MB")
    return "image/" + match[1], decoded
