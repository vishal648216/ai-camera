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
            out_img = remove(img, session=session, post_process_mask=True)
        except Exception as segErr:
            print(f"Notice fallback to u2netp: {segErr}", file=sys.stderr)
            session = new_session('u2netp')
            out_img = remove(img, session=session, post_process_mask=True)
        
        # Ensure RGBA
        if out_img.mode != 'RGBA':
            out_img = out_img.convert('RGBA')
            
        # Subtle 1px anti-aliasing on the alpha channel for ultra-smooth edge blending
        from PIL import ImageFilter
        r, g, b, a = out_img.split()
        a_smooth = a.filter(ImageFilter.GaussianBlur(radius=0.7))
        out_img = Image.merge('RGBA', (r, g, b, a_smooth))
            
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

