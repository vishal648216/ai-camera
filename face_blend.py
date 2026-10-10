import sys
import cv2
import numpy as np
import os

def detect_face(image, check_center=False):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    xml_path = os.path.join(script_dir, "haarcascade_frontalface_default.xml")
    if not os.path.exists(xml_path):
        xml_path = "haarcascade_frontalface_default.xml"
        
    face_cascade = cv2.CascadeClassifier(xml_path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    
    if len(faces) == 0:
        # Fallback with higher sensitivity
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(20, 20))
        
    if len(faces) == 0:
        return None
        
    h_img, w_img = image.shape[:2]
    
    # Get the best matching face
    best_face = None
    max_area = 0
    for (x, y, w, h) in faces:
        # If check_center is True, the face must be near the horizontal center of the portrait
        if check_center:
            face_cx = x + w // 2
            # Must be within 18% of the horizontal center
            if abs(face_cx - w_img // 2) > w_img * 0.18:
                continue
            # Must be in the upper 60% of the image
            if (y + h // 2) > h_img * 0.6:
                continue
                
        area = w * h
        if area > max_area:
            max_area = area
            best_face = (int(x), int(y), int(w), int(h))
            
    return best_face

def extract_face_crop(src, src_face):
    """Extract cropped face with padding from source image."""
    if src_face:
        sx, sy, sw, sh = src_face
        padding_x = int(sw * 0.25)
        padding_y_top = int(sh * 0.35)   # more forehead
        padding_y_bot = int(sh * 0.15)
        sx = max(0, sx - padding_x)
        sy = max(0, sy - padding_y_top)
        ex = min(src.shape[1], sx + sw + 2*padding_x)
        ey = min(src.shape[0], sy + sh + padding_y_top + padding_y_bot)
        return src[sy:ey, sx:ex]
    return src

def paste_face_on_banner(src_crop, dst, target_x, target_y, target_size):
    """
    Paste src face crop onto dst at specified position using seamlessClone or alpha blend.
    target_x, target_y is the CENTER of where face should go.
    target_size is the diameter.
    """
    h_dst, w_dst = dst.shape[:2]
    face_w = target_size
    face_h = int(target_size * 1.3)  # slightly taller than wide for portrait
    
    src_resized = cv2.resize(src_crop, (face_w, face_h))
    
    # Create elliptical mask
    mask = np.zeros(src_resized.shape, src_resized.dtype)
    center_m = (face_w // 2, int(face_h * 0.45))
    axes_m = (int(face_w * 0.46), int(face_h * 0.50))
    cv2.ellipse(mask, center_m, axes_m, 0, 0, 360, (255, 255, 255), -1)
    mask = cv2.GaussianBlur(mask, (35, 35), 0)
    
    # Clamp center so face doesn't go out of bounds
    cx = max(face_w // 2, min(w_dst - face_w // 2 - 1, target_x))
    cy = max(face_h // 2, min(h_dst - face_h // 2 - 1, target_y))
    
    try:
        result = cv2.seamlessClone(src_resized, dst, mask, (cx, cy), cv2.NORMAL_CLONE)
        return result, True
    except Exception as e:
        print("seamlessClone failed, using alpha blend:", str(e))
        # Fallback alpha blend
        x1 = cx - face_w // 2
        y1 = cy - face_h // 2
        x2 = x1 + face_w
        y2 = y1 + face_h
        # Clamp
        x1c, y1c = max(0, x1), max(0, y1)
        x2c, y2c = min(w_dst, x2), min(h_dst, y2)
        sx1, sy1 = x1c - x1, y1c - y1
        sx2, sy2 = sx1 + (x2c - x1c), sy1 + (y2c - y1c)
        
        roi = dst[y1c:y2c, x1c:x2c].copy()
        src_roi = src_resized[sy1:sy2, sx1:sx2]
        mask_roi = mask[sy1:sy2, sx1:sx2].astype(float) / 255.0
        if roi.shape == src_roi.shape and mask_roi.shape[:2] == roi.shape[:2]:
            result_roi = (src_roi * mask_roi + roi * (1.0 - mask_roi)).astype(np.uint8)
            dst_copy = dst.copy()
            dst_copy[y1c:y2c, x1c:x2c] = result_roi
            return dst_copy, True
        return dst, False

def blend_faces(src_path, target_path, out_path):
    src = cv2.imread(src_path)
    dst = cv2.imread(target_path)
    
    if src is None or dst is None:
        print("Error: Could not read images.")
        sys.exit(1)

    h_dst, w_dst = dst.shape[:2]
    
    # Detect face in source selfie
    src_face = detect_face(src)
    if src_face is None:
        print("No face detected in source selfie - using full image center crop")
        # Use top-center of image as fallback face crop
        crop_h = min(src.shape[0], src.shape[1])
        crop_w = crop_h
        cy_start = 0
        cx_start = max(0, (src.shape[1] - crop_w) // 2)
        src_crop = src[cy_start:cy_start+crop_h, cx_start:cx_start+crop_w]
    else:
        src_crop = extract_face_crop(src, src_face)

    # Detect face in target image (enforce check_center to avoid false background matches)
    target_face = detect_face(dst, check_center=True)
    
    if target_face:
        # Normal face swap - blend onto detected face region
        x, y, tw, th = target_face
        target_size = max(tw, th)
        target_cx = x + tw // 2
        target_cy = y + int(th * 0.55)
        
        result, success = paste_face_on_banner(src_crop, dst, target_cx, target_cy, target_size)
        if success:
            cv2.imwrite(out_path, result)
            print("Success")
        else:
            cv2.imwrite(out_path, dst)
            print("Fallback: wrote original target")
    else:
        # No face in target (e.g. plain banner/template) 
        # Smart paste: upper-center, 30% of banner width in size
        print("No face in target - smart paste at upper center")
        target_size = int(w_dst * 0.30)
        target_cx = w_dst // 2
        target_cy = int(h_dst * 0.22)   # upper portion of banner
        
        result, success = paste_face_on_banner(src_crop, dst, target_cx, target_cy, target_size)
        if success:
            cv2.imwrite(out_path, result)
            print("Success (smart paste)")
        else:
            cv2.imwrite(out_path, dst)
            print("Fallback: wrote original target (no face area)")

import json

def check_quality(image_path):
    image = cv2.imread(image_path)
    if image is None:
        return {"valid": False, "reason": "Could not read image"}

    script_dir = os.path.dirname(os.path.abspath(__file__))
    xml_path = os.path.join(script_dir, "haarcascade_frontalface_default.xml")
    if not os.path.exists(xml_path):
        xml_path = "haarcascade_frontalface_default.xml"
        
    face_cascade = cv2.CascadeClassifier(xml_path)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    
    if len(faces) == 0:
        # Retry with looser threshold
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.05, minNeighbors=3, minSize=(20, 20))
        
    if len(faces) == 0:
        return {"valid": False, "face_count": 0, "reason": "Face not detected. Please try again."}
        
    # Calculate score for each face to find the best primary face
    h_img, w_img = image.shape[:2]
    img_cx, img_cy = w_img / 2.0, h_img / 2.0
    best_face = None
    best_score = -1.0

    for (fx, fy, fw, fh) in faces:
        fcx, fcy = fx + fw / 2.0, fy + fh / 2.0
        dist_from_center = ((fcx - img_cx)**2 + (fcy - img_cy)**2)**0.5
        norm_center = 1.0 - (dist_from_center / (w_img**2 + h_img**2)**0.5)
        norm_size = (fw * fh) / (w_img * h_img)
        score = (norm_size * 0.6) + (norm_center * 0.4)
        if score > best_score:
            best_score = score
            best_face = (fx, fy, fw, fh)

    (x, y, w, h) = best_face
    
    if w < w_img * 0.12 or h < h_img * 0.12:
        return {"valid": False, "reason": "Please move closer to the camera."}
        
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
    mean_brightness = gray.mean()
    
    if blur_score < 10.0:
        return {"valid": False, "reason": "Please take a clearer photo."}
        
    if mean_brightness < 20:
        return {"valid": False, "reason": "Please take a photo with better lighting."}
        
    return {"valid": True, "face_count": len(faces), "blur_score": float(blur_score), "brightness": float(mean_brightness), "reason": "OK"}

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check-quality":
        result = check_quality(sys.argv[2])
        print(json.dumps(result))
    elif len(sys.argv) >= 4:
        blend_faces(sys.argv[1], sys.argv[2], sys.argv[3])
    else:
        print("Usage: python face_blend.py <src> <target> <out> OR python face_blend.py --check-quality <img_path>")


