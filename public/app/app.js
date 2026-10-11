/**
 * PersonaPRO AI Photo Booth — Web Application Logic (1:1 with Flutter App)
 * Pure Vanilla ES6+, Zero Bloat, Ultra-Fast Execution (60 FPS)
 */

(function () {
    'use strict';

    // Application State
    const state = {
        currentScreen: 'screen-selfie',
        capturedBlob: null,
        capturedDataUrl: null,
        selectedTemplateId: null,
        selectedTemplateName: null,
        backendTemplates: [],
        cameraStream: null,
        cameraFacingMode: 'user', // 'user' (front) or 'environment' (back)
        isGenerating: false,
        backendUrl: detectBackendUrl(),
        currentRegId: null,
        currentShareUrl: null,
        currentResultData: null
    };

    // Detect Best Backend URL automatically
    function detectBackendUrl() {
        const origin = window.location.origin;
        // If hosted on vercel or port 5000 directly, use relative/same origin
        if (origin.includes('vercel.app') || origin.includes(':5000')) {
            return origin.replace(/\/$/, '');
        }
        // If testing on localhost web server (e.g. port 3000, 8080)
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:5000';
        }
        // Universal fallback to live deployed Vercel backend
        return 'https://ai-camera-pi.vercel.app';
    }

    // DOM Elements
    const elements = {
        // Navigation & Header
        btnBack: document.getElementById('btn-back'),
        headerTitle: document.getElementById('header-title'),
        serverStatusPill: document.getElementById('server-status-pill'),
        serverStatusText: document.getElementById('server-status-text'),
        
        // Screens
        screenSelfie: document.getElementById('screen-selfie'),
        screenThemes: document.getElementById('screen-themes'),
        screenResult: document.getElementById('screen-result'),

        // Screen 1: Selfie
        selfieCircle: document.getElementById('selfie-circle'),
        selfiePlaceholder: document.getElementById('selfie-placeholder'),
        webcamVideo: document.getElementById('webcam-video'),
        selfiePreviewImg: document.getElementById('selfie-preview-img'),
        cameraFlash: document.getElementById('camera-flash'),
        btnSwitchCamera: document.getElementById('btn-switch-camera'),
        btnOpenCamera: document.getElementById('btn-open-camera'),
        btnSnapCamera: document.getElementById('btn-snap-camera'),
        btnOpenGallery: document.getElementById('btn-open-gallery'),
        fileInputCamera: document.getElementById('file-input-camera'),
        fileInputGallery: document.getElementById('file-input-gallery'),
        btnProceedThemes: document.getElementById('btn-proceed-themes'),
        hiddenSnapCanvas: document.getElementById('hidden-snap-canvas'),
        
        // Fullscreen Live Camera Modal
        modalCamera: document.getElementById('modal-camera'),
        modalWebcamVideo: document.getElementById('modal-webcam-video'),
        btnModalSnap: document.getElementById('btn-modal-snap'),
        btnCloseCameraModal: document.getElementById('btn-close-camera-modal'),
        btnModalFlipCamera: document.getElementById('btn-modal-flip-camera'),
        modalCameraFlash: document.getElementById('modal-camera-flash'),
        
        // Attendee Details
        btnToggleAttendee: document.getElementById('btn-toggle-attendee'),
        attendeeForm: document.getElementById('attendee-form'),
        attendeeChevron: document.getElementById('attendee-chevron'),
        inputName: document.getElementById('input-name'),
        inputCompany: document.getElementById('input-company'),
        inputEmail: document.getElementById('input-email'),

        // Screen 2: Themes
        templatesGrid: document.getElementById('templates-grid'),
        templateSearch: document.getElementById('template-search'),
        btnRefreshTemplates: document.getElementById('btn-refresh-templates'),
        btnGeneratePhoto: document.getElementById('btn-generate-photo'),

        // Screen 3: Result
        generationLoader: document.getElementById('generation-loader'),
        loaderStatusText: document.getElementById('loader-status-text'),
        loaderProgressBar: document.getElementById('loader-progress-bar'),
        resultErrorCard: document.getElementById('result-error-card'),
        errorTitle: document.getElementById('error-title'),
        errorMessage: document.getElementById('error-message'),
        btnRetryGeneration: document.getElementById('btn-retry-generation'),
        btnErrorChangeTemplate: document.getElementById('btn-error-change-template'),
        resultShowcaseCard: document.getElementById('result-showcase-card'),
        finalResultImg: document.getElementById('final-result-img'),
        btnRetake: document.getElementById('btn-retake'),
        btnOpenQr: document.getElementById('btn-open-qr'),
        btnDownloadResult: document.getElementById('btn-download-result'),
        btnChangeTemplate: document.getElementById('btn-change-template'),
        btnNewPhotoMain: document.getElementById('btn-new-photo-main'),
        btnHeaderNew: document.getElementById('btn-header-new'),

        // Modal QR
        modalQr: document.getElementById('modal-qr'),
        qrContainer: document.getElementById('qr-container'),
        qrShareUrl: document.getElementById('qr-share-url'),
        btnCopyUrl: document.getElementById('btn-copy-url'),
        btnCloseQr: document.getElementById('btn-close-qr')
    };

    // =========================================================================
    // Initialization
    // =========================================================================
    function init() {
        setupEventListeners();
        checkBackendHealth();
        loadTemplates();
    }

    // Health Check on Active Backend
    async function checkBackendHealth() {
        try {
            const resp = await fetch(`${state.backendUrl}/`, { method: 'GET', mode: 'cors' });
            if (resp.ok) {
                elements.serverStatusPill.classList.remove('offline');
                elements.serverStatusText.textContent = 'Connected';
            } else {
                throw new Error('Non-200');
            }
        } catch (e) {
            // Try fallback to local port 5000 if vercel was tried or vice-versa
            if (state.backendUrl.includes('vercel.app')) {
                try {
                    const localResp = await fetch('http://localhost:5000/', { method: 'GET' });
                    if (localResp.ok) {
                        state.backendUrl = 'http://localhost:5000';
                        elements.serverStatusPill.classList.remove('offline');
                        elements.serverStatusText.textContent = 'Localhost';
                        return;
                    }
                } catch(le) {}
            }
            elements.serverStatusPill.classList.add('offline');
            elements.serverStatusText.textContent = 'Cloud Mode';
        }
    }

    // =========================================================================
    // Event Listeners Setup
    // =========================================================================
    function setupEventListeners() {
        // Navigation
        elements.btnBack.addEventListener('click', handleGoBack);

        // Attendee Info Accordion
        elements.btnToggleAttendee.addEventListener('click', () => {
            const isHidden = elements.attendeeForm.classList.contains('hidden');
            elements.attendeeForm.classList.toggle('hidden', !isHidden);
            elements.btnToggleAttendee.classList.toggle('active', isHidden);
        });

        // Screen 1: Camera Controls (Fullscreen Modal Viewfinder)
        elements.btnOpenCamera.addEventListener('click', openCameraModal);
        elements.selfieCircle.addEventListener('click', () => {
            if (!state.capturedBlob) openCameraModal();
        });
        if (elements.btnCloseCameraModal) elements.btnCloseCameraModal.addEventListener('click', closeCameraModal);
        if (elements.btnModalFlipCamera) elements.btnModalFlipCamera.addEventListener('click', flipCamera);
        if (elements.btnModalSnap) elements.btnModalSnap.addEventListener('click', captureModalLivePhoto);

        elements.btnOpenGallery.addEventListener('click', () => elements.fileInputGallery.click());
        elements.fileInputGallery.addEventListener('change', handleFileSelected);
        elements.fileInputCamera.addEventListener('change', handleFileSelected);

        // Screen 1: Proceed
        elements.btnProceedThemes.addEventListener('click', () => {
            stopCameraStream();
            navigateToScreen('screen-themes');
        });

        // Screen 2: Templates
        elements.templateSearch.addEventListener('input', filterTemplates);
        elements.btnRefreshTemplates.addEventListener('click', () => loadTemplates(true));
        elements.btnGeneratePhoto.addEventListener('click', startGenerationProcess);

        // Screen 3: Results
        elements.btnRetake.addEventListener('click', resetToSelfie);
        if (elements.btnNewPhotoMain) elements.btnNewPhotoMain.addEventListener('click', resetToSelfie);
        if (elements.btnHeaderNew) elements.btnHeaderNew.addEventListener('click', resetToSelfie);
        elements.btnOpenQr.addEventListener('click', openQrModal);
        elements.btnCloseQr.addEventListener('click', closeQrModal);
        elements.modalQr.addEventListener('click', (e) => {
            if (e.target === elements.modalQr) closeQrModal();
        });
        elements.btnCopyUrl.addEventListener('click', copyShareUrl);
        elements.btnDownloadResult.addEventListener('click', downloadFinalImage);
        elements.btnChangeTemplate.addEventListener('click', () => navigateToScreen('screen-themes'));
        elements.btnRetryGeneration.addEventListener('click', startGenerationProcess);
        elements.btnErrorChangeTemplate.addEventListener('click', () => navigateToScreen('screen-themes'));
    }

    // =========================================================================
    // Screen Navigation
    // =========================================================================
    function navigateToScreen(screenId) {
        // Hide all screens
        [elements.screenSelfie, elements.screenThemes, elements.screenResult].forEach(s => {
            s.classList.remove('active');
        });

        // Show target screen
        const target = document.getElementById(screenId);
        if (target) {
            target.classList.add('active');
            state.currentScreen = screenId;
        }

        // Header Updates
        if (screenId === 'screen-selfie') {
            elements.btnBack.classList.add('hidden');
            elements.headerTitle.textContent = 'Capture Your Look';
        } else if (screenId === 'screen-themes') {
            elements.btnBack.classList.remove('hidden');
            elements.headerTitle.textContent = 'Master Templates';
        } else if (screenId === 'screen-result') {
            elements.btnBack.classList.remove('hidden');
            elements.headerTitle.textContent = 'AI Studio Result';
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function handleGoBack() {
        if (state.currentScreen === 'screen-themes') {
            navigateToScreen('screen-selfie');
        } else if (state.currentScreen === 'screen-result') {
            navigateToScreen('screen-themes');
        }
    }

    // =========================================================================
    // =========================================================================
    // Fullscreen Camera Popup Modal Handling
    // =========================================================================
    async function openCameraModal() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                elements.fileInputCamera.click();
                return;
            }

            elements.modalCamera.classList.remove('hidden');

            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: state.cameraFacingMode },
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    },
                    audio: false
                });
            } catch (e1) {
                console.warn("Retrying with simple facingMode:", e1.message);
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: state.cameraFacingMode },
                        audio: false
                    });
                } catch (e2) {
                    console.warn("Retrying with basic video constraint:", e2.message);
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                }
            }

            state.cameraStream = stream;
            elements.modalWebcamVideo.srcObject = stream;
            await elements.modalWebcamVideo.play().catch(() => {});

        } catch (err) {
            console.warn("Camera modal stream notice:", err.message);
            closeCameraModal();
            elements.fileInputCamera.click();
        }
    }

    function closeCameraModal() {
        stopCameraStream();
        if (elements.modalCamera) {
            elements.modalCamera.classList.add('hidden');
        }
    }

    function stopCameraStream() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(t => t.stop());
            state.cameraStream = null;
        }
        if (elements.modalWebcamVideo) {
            elements.modalWebcamVideo.srcObject = null;
        }
        if (elements.webcamVideo) {
            elements.webcamVideo.srcObject = null;
            elements.webcamVideo.classList.add('hidden');
        }
    }

    async function flipCamera() {
        state.cameraFacingMode = state.cameraFacingMode === 'user' ? 'environment' : 'user';
        stopCameraStream();
        await openCameraModal();
    }

    function captureModalLivePhoto() {
        if (!state.cameraStream) return;

        // Visual Shutter Flash animation
        if (elements.modalCameraFlash) {
            elements.modalCameraFlash.classList.add('flash-active');
        }

        setTimeout(() => {
            if (elements.modalCameraFlash) {
                elements.modalCameraFlash.classList.remove('flash-active');
            }

            const video = elements.modalWebcamVideo;
            const canvas = elements.hiddenSnapCanvas;
            const maxDim = 1280;
            let w = video.videoWidth || 720;
            let h = video.videoHeight || 960;

            if (w > maxDim || h > maxDim) {
                if (w > h) {
                    h = Math.round((h * maxDim) / w);
                    w = maxDim;
                } else {
                    w = Math.round((w * maxDim) / h);
                    h = maxDim;
                }
            }

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');

            // If front selfie camera, mirror horizontally so captured photo looks natural
            if (state.cameraFacingMode === 'user') {
                ctx.translate(w, 0);
                ctx.scale(-1, 1);
            }
            ctx.drawImage(video, 0, 0, w, h);

            canvas.toBlob((blob) => {
                if (blob) {
                    state.capturedBlob = blob;
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    state.capturedDataUrl = dataUrl;

                    // Immediately display captured selfie in circular frame on main screen
                    elements.selfiePreviewImg.src = dataUrl;
                    elements.selfiePreviewImg.classList.remove('hidden');
                    elements.selfiePlaceholder.classList.add('hidden');
                    elements.selfieCircle.classList.add('has-photo');
                    elements.btnProceedThemes.disabled = false;

                    // Close the full-screen camera popup modal cleanly
                    closeCameraModal();
                }
            }, 'image/jpeg', 0.92);

        }, 150);
    }

    function handleFileSelected(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        stopCameraStream();

        // Downscale image to max 1280px via HTML5 Image & Canvas
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1280;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) {
                        h = Math.round((h * maxDim) / w);
                        w = maxDim;
                    } else {
                        w = Math.round((w * maxDim) / h);
                        h = maxDim;
                    }
                }

                const canvas = elements.hiddenSnapCanvas;
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                canvas.toBlob((blob) => {
                    state.capturedBlob = blob || file;
                    state.capturedDataUrl = canvas.toDataURL('image/jpeg', 0.90);
                    
                    elements.selfiePreviewImg.src = state.capturedDataUrl;
                    elements.selfiePreviewImg.classList.remove('hidden');
                    elements.selfiePlaceholder.classList.add('hidden');
                    elements.selfieCircle.classList.add('has-photo');
                    elements.btnProceedThemes.disabled = false;
                }, 'image/jpeg', 0.90);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    // =========================================================================
    // Master Template Management
    // =========================================================================
    async function loadTemplates(forceRefresh = false) {
        elements.templatesGrid.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading master templates...</p>
            </div>
        `;

        try {
            const resp = await fetch(`${state.backendUrl}/api/templates?t=${Date.now()}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (Array.isArray(data) && data.length > 0) {
                state.backendTemplates = data;
                renderTemplates(data);
                // Pre-select first template
                if (!state.selectedTemplateId) {
                    selectTemplate(data[0].id, data[0].name);
                }
                return;
            }
            throw new Error("No templates returned");
        } catch (err) {
            console.warn("Notice loading templates from active backend, trying fallback...", err.message);
            // Fallback templates matching backend
            const fallbacks = [
                {
                    id: 'inspire_manak',
                    name: '🇮🇳 12th Inspire Manak Exhibition',
                    desc: 'Official Full-Body Event Backdrop',
                    imageUrl: `${state.backendUrl}/uploads/templates/inspire_manak.png`,
                    isLive: true
                },
                {
                    id: 'myur',
                    name: '✨ Paris Eiffel Tower (Myur)',
                    desc: 'Cinematic Grand Landmark Scene',
                    imageUrl: `${state.backendUrl}/uploads/templates/myur.png`
                },
                {
                    id: 'parish',
                    name: '🏰 Grand Paris Tower (Parish)',
                    desc: 'European Architecture Backdrop',
                    imageUrl: `${state.backendUrl}/uploads/templates/parish.png`
                }
            ];
            state.backendTemplates = fallbacks;
            renderTemplates(fallbacks);
            if (!state.selectedTemplateId) {
                selectTemplate(fallbacks[0].id, fallbacks[0].name);
            }
        }
    }

    function renderTemplates(templates) {
        if (!templates || templates.length === 0) {
            elements.templatesGrid.innerHTML = `
                <div class="loading-state">
                    <p>No master templates found.</p>
                </div>
            `;
            return;
        }

        elements.templatesGrid.innerHTML = '';
        templates.forEach((t) => {
            const isSelected = state.selectedTemplateId === t.id;
            const isLive = t.isBanner || t.id === 'inspire_manak' || t.name.includes('Inspire');
            
            // Build full image url
            let imgUrl = t.imageUrl || t.imageData || '';
            if (imgUrl.startsWith('/') || imgUrl.startsWith('uploads/')) {
                imgUrl = `${state.backendUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
            }

            const card = document.createElement('div');
            card.className = `template-card ${isSelected ? 'selected' : ''}`;
            card.dataset.id = t.id;
            card.dataset.name = t.name;

            card.innerHTML = `
                <div class="template-thumb-wrap">
                    <img src="${imgUrl}" alt="${t.name}" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600';">
                    ${isLive ? '<div class="badge-live">LIVE EVENT</div>' : ''}
                    ${isSelected ? '<div class="selected-check-bubble">✓</div>' : ''}
                </div>
                <div class="template-meta-wrap">
                    <div class="template-name">${t.name}</div>
                    <div class="template-desc">${t.desc || (t.mode === 'face_swap' ? 'Portrait Blend' : 'Full-Body Scene')}</div>
                </div>
            `;

            card.addEventListener('click', () => {
                selectTemplate(t.id, t.name);
            });

            elements.templatesGrid.appendChild(card);
        });
    }

    function selectTemplate(templateId, templateName) {
        state.selectedTemplateId = templateId;
        state.selectedTemplateName = templateName;
        
        // Update DOM
        const cards = elements.templatesGrid.querySelectorAll('.template-card');
        cards.forEach(c => {
            if (c.dataset.id === templateId) {
                c.classList.add('selected');
                if (!c.querySelector('.selected-check-bubble')) {
                    const bubble = document.createElement('div');
                    bubble.className = 'selected-check-bubble';
                    bubble.textContent = '✓';
                    c.querySelector('.template-thumb-wrap').appendChild(bubble);
                }
            } else {
                c.classList.remove('selected');
                const bubble = c.querySelector('.selected-check-bubble');
                if (bubble) bubble.remove();
            }
        });

        elements.btnGeneratePhoto.disabled = false;
    }

    function filterTemplates(e) {
        const query = e.target.value.toLowerCase().trim();
        const filtered = state.backendTemplates.filter(t => 
            t.name.toLowerCase().includes(query) || (t.desc && t.desc.toLowerCase().includes(query))
        );
        renderTemplates(filtered);
    }

    // =========================================================================
    // AI Photo Booth Generation Engine
    // =========================================================================
    async function startGenerationProcess() {
        if (!state.capturedBlob) {
            alert('Please take or upload your selfie first!');
            navigateToScreen('screen-selfie');
            return;
        }

        if (!state.selectedTemplateId) {
            alert('Please select a master template!');
            return;
        }

        navigateToScreen('screen-result');

        // Reset Result View States
        elements.generationLoader.classList.remove('hidden');
        elements.resultErrorCard.classList.add('hidden');
        elements.resultShowcaseCard.classList.add('hidden');
        elements.btnBack.classList.add('hidden');

        // Progress Stepper Simulation
        const progressSteps = [
            { text: "⚡ Analyzing facial lighting & contours...", delay: 800 },
            { text: "✨ Removing background with neural AI...", delay: 2200 },
            { text: "🎨 Harmonizing subject tone & studio shadows...", delay: 4500 },
            { text: "🏆 Finalizing master photographic composite...", delay: 7000 }
        ];

        let stepIndex = 0;
        const progressInterval = setInterval(() => {
            if (stepIndex < progressSteps.length) {
                elements.loaderStatusText.textContent = progressSteps[stepIndex].text;
                stepIndex++;
            }
        }, 2200);

        try {
            // Build Multipart Form Data
            const formData = new FormData();
            formData.append('selfie', state.capturedBlob, 'selfie.jpg');
            formData.append('themeId', state.selectedTemplateId);
            formData.append('themeName', state.selectedTemplateName || 'Event Masterpiece');
            formData.append('name', elements.inputName.value.trim() || 'Guest User');
            formData.append('company', elements.inputCompany.value.trim() || 'Self');
            formData.append('email', elements.inputEmail.value.trim() || 'guest@example.com');
            formData.append('gender', 'Male');

            // Set generous 90-second timeout matching our fixed backend
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000);

            const resp = await fetch(`${state.backendUrl}/api/register`, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            clearInterval(progressInterval);

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                throw new Error(errData.message || `Processing failed (${resp.status})`);
            }

            const data = await resp.json();

            if (data.success === false) {
                throw new Error(data.message || 'Generation failed');
            }

            // Success Display
            state.currentRegId = data.id;
            state.currentShareUrl = data.shareUrl || `${state.backendUrl}/share/${data.id}`;
            state.currentResultData = data.resultData;

            // Form full result image source
            let finalSrc = data.resultData;
            if (!finalSrc || !finalSrc.startsWith('data:image')) {
                const relUrl = data.resultUrl || '';
                finalSrc = relUrl.startsWith('http') ? relUrl : `${state.backendUrl}${relUrl.startsWith('/') ? '' : '/'}${relUrl}`;
            }

            elements.finalResultImg.src = finalSrc;
            
            // Switch UI
            elements.generationLoader.classList.add('hidden');
            elements.resultShowcaseCard.classList.remove('hidden');
            elements.btnBack.classList.remove('hidden');

        } catch (err) {
            clearInterval(progressInterval);
            console.error("Generation error:", err);
            
            elements.generationLoader.classList.add('hidden');
            elements.resultErrorCard.classList.remove('hidden');
            elements.btnBack.classList.remove('hidden');

            const isTimeout = err.name === 'AbortError' || err.message.includes('timeout') || err.message.includes('aborted');
            elements.errorTitle.textContent = isTimeout ? 'Generation Timeout' : 'Photo Processing Notice';
            elements.errorMessage.textContent = isTimeout 
                ? 'Network request timed out. Please check your internet connection or try again.'
                : (err.message || 'Please retake your selfie or select another template.');
        }
    }

    // =========================================================================
    // QR Code Modal & Instant Mobile Sharing
    // =========================================================================
    function openQrModal() {
        const shareUrl = state.currentShareUrl || `${state.backendUrl}/share/${state.currentRegId || 'demo'}`;
        elements.qrShareUrl.value = shareUrl;

        // Render QR Code via QRCode.js
        elements.qrContainer.innerHTML = '';
        try {
            new QRCode(elements.qrContainer, {
                text: shareUrl,
                width: 190,
                height: 190,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.M
            });
        } catch(e) {
            elements.qrContainer.innerHTML = `<img src="${state.backendUrl}/api/qr/${state.currentRegId}" width="190" height="190" alt="QR Code">`;
        }

        elements.modalQr.classList.remove('hidden');
    }

    function closeQrModal() {
        elements.modalQr.classList.add('hidden');
    }

    function copyShareUrl() {
        const input = elements.qrShareUrl;
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value).then(() => {
            elements.btnCopyUrl.textContent = 'COPIED!';
            setTimeout(() => elements.btnCopyUrl.textContent = 'COPY', 2000);
        });
    }

    // Download High-Resolution Image to Local Device
    function downloadFinalImage() {
        const link = document.createElement('a');
        link.href = elements.finalResultImg.src;
        link.download = `persona_ai_photo_${state.currentRegId || Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Complete Reset Flow Back to Selfie Capture (For Next Person)
    function resetToSelfie() {
        closeCameraModal();
        state.capturedBlob = null;
        state.capturedDataUrl = null;
        state.selectedTemplateId = null;
        state.selectedTemplateName = null;
        state.currentRegId = null;
        state.currentShareUrl = null;
        state.currentResultData = null;

        // Reset attendee form
        if (elements.inputName) elements.inputName.value = '';
        if (elements.inputCompany) elements.inputCompany.value = '';
        if (elements.inputEmail) elements.inputEmail.value = '';

        // Reset selfie preview state
        elements.selfiePreviewImg.src = '';
        elements.selfiePreviewImg.classList.add('hidden');
        elements.selfiePlaceholder.classList.remove('hidden');
        elements.selfieCircle.classList.remove('has-photo');
        elements.btnProceedThemes.disabled = true;

        // Reset template selection state
        elements.btnGeneratePhoto.disabled = true;
        document.querySelectorAll('.template-card').forEach(c => {
            c.classList.remove('selected');
            const check = c.querySelector('.selected-check-bubble');
            if (check) check.remove();
        });

        // Hide result showcases & loading overlays
        elements.resultShowcaseCard.classList.add('hidden');
        elements.generationLoader.classList.add('hidden');
        elements.resultErrorCard.classList.add('hidden');

        // Clean transition back to Screen 1
        navigateToScreen('screen-selfie');
    }

    // Start App
    window.addEventListener('DOMContentLoaded', init);

})();
