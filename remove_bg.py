import sys
import io
from rembg import remove
from PIL import Image

def process_image(input_path, output_path):
    try:
        with open(input_path, 'rb') as i:
            input_data = i.read()
            
        output_data = remove(input_data)
        
        # Save as PNG
        with open(output_path, 'wb') as o:
            o.write(output_data)
            
        print("Success")
    except Exception as e:
        print("Error:", str(e))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python remove_bg.py <input> <output>")
        sys.exit(1)
    process_image(sys.argv[1], sys.argv[2])
