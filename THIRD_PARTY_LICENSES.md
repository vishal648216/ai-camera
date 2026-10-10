# Third-Party Licenses & Model Registry

This document records the open-source licenses and commercial use compatibility of all AI models, computer vision dependencies, and libraries used in the AI Photo Booth system.

---

## 1. AI Models & Computer Vision Engines

### 1. OpenCV YuNet (Face Detection & Landmark Estimation)
- **Model / Library**: `YuNet` (ONNX / OpenCV `cv2.CascadeClassifier` & `cv2.FaceDetectorYN`)
- **License**: Apache-2.0 / BSD 3-Clause License
- **Commercial Use**: Allowed (Fully Permissive for Commercial & Private Use)
- **Purpose**: Real-time face detection, bounding box extraction, and facial landmark orientation.

### 2. Ghost_1_256 (Primary Face Swap Engine)
- **Model Architecture**: `Ghost_1_256` (Ghost Face Swap model family)
- **License**: Apache-2.0
- **Commercial Use**: Allowed (Permissive Open-Source)
- **Purpose**: High-fidelity identity preservation and face swap onto master template target regions without generative image hallucination.

### 3. rembg / U2Net (Background Removal Engine)
- **Library**: `rembg` (Python)
- **Model**: U2-Net (Salient Object Detection)
- **License**: MIT License
- **Commercial Use**: Allowed
- **Purpose**: Automatic foreground-background segmentation and subject isolation.

---

## 2. Core Dependencies & Libraries

| Dependency | License | Commercial Status |
| :--- | :--- | :--- |
| **OpenCV (`opencv-python`)** | Apache-2.0 / BSD | Free for Commercial Use |
| **Sharp (`sharp`)** | Apache-2.0 | Free for Commercial Use |
| **Express.js** | MIT | Free for Commercial Use |
| **Flutter SDK** | BSD 3-Clause | Free for Commercial Use |
| **`qr_flutter` / `qrcode`** | MIT | Free for Commercial Use |

---

> [!NOTE]
> **License Policy Enforcement**: InSwapper-128 is NOT used as the primary production model due to InsightFace default non-commercial restriction guidelines. Ghost_1_256 and OpenCV YuNet/Poisson blending form the core, legally compliant face-swap engine.
