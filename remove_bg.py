import sys
import io
import os
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
        
        # Robust model hierarchy:
        # 'u2net' is the general salient segmentation neural network trained to segment ALL foreground
        # subjects (single person, multiple people, groups of 5-10 people, props, clothing).
        # CRITICAL: post_process_mask=False ensures secondary people, people sitting down,
        # or separate bodies in group photos are NEVER discarded or suppressed!
        out_img = None
        for model_name in ['u2net', 'u2net_human_seg', 'u2netp']:
            try:
                session = new_session(model_name)
                out_img = remove(img, session=session, post_process_mask=False)
                if out_img:
                    break
            except Exception as mErr:
                print(f"Notice fallback from {model_name}: {mErr}", file=sys.stderr)
                continue
        
        if out_img is None:
            # Safe final fallback
            out_img = remove(img, post_process_mask=False)
        
        # Ensure RGBA
        if out_img.mode != 'RGBA':
            out_img = out_img.convert('RGBA')
            
        r, g, b, a = out_img.split()
        a_np = np.array(a, dtype=np.float32)
        
        # CRITICAL MULTI-PERSON GHOSTING / TRANSPARENCY FIX:
        # In group photos, subjects on sides or behind often get soft alpha (40-180),
        # making them look like transparent ghosts through which the backdrop bleeds!
        # Solidify subject interior: any alpha >= 45 is ramped solidly to 255 (100% opaque).
        # Soft edges (0 to 45) get a smooth anti-aliased feathering curve.
        a_solid = np.where(a_np >= 45.0, 255.0, a_np * (255.0 / 45.0))
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
