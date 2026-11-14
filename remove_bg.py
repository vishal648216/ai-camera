import sys
import io
import os
import cv2
import numpy as np
from rembg import remove, new_session
from PIL import Image, ImageFilter

def process_image(input_path, output_path):
    try:
        img = Image.open(input_path)
        # Ensure RGB
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
        
        # Downscale huge mobile camera images to max 1280px for crisp detail & fast inference
        img.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        
        # CRITICAL MODEL HIERARCHY:
        # 1. 'u2net_human_seg' is trained specifically for Human Body & Person segmentation!
        #    It strictly ignores background posters, paintings, wall decor, picture frames, and tea/drink cups!
        # 2. 'u2netp' / 'u2net' serve as robust fallbacks if human_seg model isn't available.
        out_img = None
        for model_name in ['u2net_human_seg', 'u2netp', 'u2net']:
            try:
                session = new_session(model_name)
                out_img = remove(img, session=session, post_process_mask=False)
                if out_img:
                    break
            except Exception as mErr:
                print(f"Notice fallback from {model_name}: {mErr}", file=sys.stderr)
                continue
        
        if out_img is None:
            out_img = remove(img, post_process_mask=False)
        
        # Ensure RGBA
        if out_img.mode != 'RGBA':
            out_img = out_img.convert('RGBA')
            
        r, g, b, a = out_img.split()
        a_np = np.array(a, dtype=np.uint8)
        img_h, img_w = a_np.shape[:2]
        
        # ANTI-BACKGROUND-ARTIFACT & WALL POSTER SUPPRESSION:
        # Detect connected foreground components. Real human subjects in photo booths
        # always touch or extend into the lower 40% of the frame (legs, torso, waist).
        # Background artifacts (wall posters, pictures, lamps, signs) float in the upper/mid
        # background completely disconnected from the human body.
        try:
            _, thresh = cv2.threshold(a_np, 35, 255, cv2.THRESH_BINARY)
            num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(thresh)
            
            if num_labels > 2: # More than background + 1 component
                # Find maximum area component (primary human subject)
                max_area = max(stats[i][cv2.CC_STAT_AREA] for i in range(1, num_labels))
                
                for i in range(1, num_labels):
                    comp_top = stats[i][cv2.CC_STAT_TOP]
                    comp_h = stats[i][cv2.CC_STAT_HEIGHT]
                    comp_bottom = comp_top + comp_h
                    comp_area = stats[i][cv2.CC_STAT_AREA]
                    
                    # Human subjects extend towards the lower part of the camera frame
                    touches_lower = comp_bottom > (img_h * 0.60)
                    is_major_subject = comp_area > (max_area * 0.25)
                    
                    # If an isolated component floats in the upper/mid frame without touching
                    # the lower body region and is much smaller than the human subject:
                    # It is an unwanted background poster, frame, light, or wall decor!
                    if not touches_lower and not is_major_subject:
                        # Erase this background artifact completely!
                        a_np[labels == i] = 0
        except Exception as cvErr:
            print(f"Notice component filter: {cvErr}", file=sys.stderr)
            
        a_float = a_np.astype(np.float32)
        
        # CRITICAL MULTI-PERSON GHOSTING / TRANSPARENCY FIX:
        # In group photos, subjects on sides or behind often get soft alpha (40-180),
        # making them look like transparent ghosts through which the backdrop bleeds!
        # Solidify subject interior: any alpha >= 45 is ramped solidly to 255 (100% opaque).
        # Soft edges (0 to 45) get a smooth anti-aliased feathering curve.
        a_solid = np.where(a_float >= 45.0, 255.0, a_float * (255.0 / 45.0))
        a_solid = np.clip(a_solid, 0, 255).astype(np.uint8)
        
        # Subtle Gaussian blur (0.6px) on alpha channel for clean, cinematic, anti-aliased edge blending
        a_smooth = Image.fromarray(a_solid).filter(ImageFilter.GaussianBlur(radius=0.6))
        
        final_img = Image.merge('RGBA', (r, g, b, a_smooth))
        final_img.save(output_path, 'PNG', optimize=True)
        print("Success")
    except Exception as e:
        print("Error:", str(e))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python remove_bg.py <input> <output>")
        sys.exit(1)
    process_image(sys.argv[1], sys.argv[2])
