import sys
import io
import os
import numpy as np
from rembg import remove, new_session
from PIL import Image

def process_image(input_path, output_path):
    try:
        img = Image.open(input_path)
        # Ensure RGB/RGBA
        if img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')
        
        # Downscale huge mobile camera images to max 1024px for fast processing
        img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        
        # Human-specific neural segmentation for clean portrait/selfie cutout
        try:
            session = new_session('u2net_human_seg')
            out_img = remove(img, session=session)
        except Exception as segErr:
            print(f"Notice fallback to u2netp: {segErr}", file=sys.stderr)
            session = new_session('u2netp')
            out_img = remove(img, session=session)
        
        # Ensure RGBA
        if out_img.mode != 'RGBA':
            out_img = out_img.convert('RGBA')
            
        # Clean solid alpha threshold so the person is 100% opaque, not see-through/ghostly
        r, g, b, a = out_img.split()
        arr_a = np.array(a, dtype=np.float32)
        # Boost alpha inside the subject: any confidence > 20 is mapped to solid 255 with soft 2px anti-aliased edge
        boosted_a = np.clip((arr_a - 15) / (50 - 15) * 255.0, 0, 255).astype(np.uint8)
        out_img = Image.merge('RGBA', (r, g, b, Image.fromarray(boosted_a)))
            
        out_img.save(output_path, 'PNG', optimize=True)
        print("Success")
    except Exception as e:
        print("Error:", str(e))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python remove_bg.py <input> <output>")
        sys.exit(1)
    process_image(sys.argv[1], sys.argv[2])

