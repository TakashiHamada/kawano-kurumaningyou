(() => {
    'use strict';

    const AUDIO_DIR = 'audio/';
    const METADATA_CSV = 'audio_metadata.csv';
    const DEFAULT_SPEED = 1;
    const REWIND_SECONDS = 5;

    const dom = {
        audio: document.getElementById('audioPlayer'),
        audioSource: document.querySelector('#audioPlayer source'),
        audioSelect: document.getElementById('audioSelect'),
        audioTitle: document.getElementById('audioTitle'),
        speaker: document.getElementById('speaker'),
        recordedDate: document.getElementById('recordedDate'),
        playPauseBtn: document.getElementById('playPauseBtn'),
        rewindBtn: document.getElementById('rewindBtn'),
        loopStartBtn: document.getElementById('loopStartBtn'),
        loopEndBtn: document.getElementById('loopEndBtn'),
        loopClearBtn: document.getElementById('loopClearBtn'),
        loopRangeDisplay: document.getElementById('loopRangeDisplay'),
        speedButtons: document.querySelectorAll('.speed-button'),
        status: document.getElementById('status'),
        imageButtonContainer: document.getElementById('imageButtonContainer'),
        imageViewBtn: document.getElementById('imageViewBtn'),
        imageModal: document.getElementById('imageModal'),
        imageModalImg: document.getElementById('imageModalImg'),
        imageModalViewport: document.getElementById('imageModalViewport'),
        imageModalCounter: document.getElementById('imageModalCounter'),
        imageModalNav: document.getElementById('imageModalNav'),
        imageModalClose: document.getElementById('imageModalClose'),
        imagePrevBtn: document.getElementById('imagePrevBtn'),
        imageNextBtn: document.getElementById('imageNextBtn'),
    };

    const state = {
        metadata: {},
        files: [],
        currentFile: null,
        loopStart: null,
        loopEnd: null,
        currentImages: [],
        imageIndex: 0,
    };

    // --- ユーティリティ ---
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
    }

    function setStatus(message) {
        dom.status.textContent = message;
    }

    // 音声が未選択の間は再生系ボタンを無効化する
    function setControlsEnabled(enabled) {
        const buttons = [
            dom.playPauseBtn,
            dom.rewindBtn,
            dom.loopStartBtn,
            dom.loopEndBtn,
            dom.loopClearBtn,
            ...dom.speedButtons,
        ];
        buttons.forEach((btn) => {
            if (btn) btn.disabled = !enabled;
        });
    }

    // --- メタデータ読み込み ---
    async function loadAudioMetadata() {
        try {
            const response = await fetch(METADATA_CSV);
            if (!response.ok) {
                throw new Error('Failed to load metadata: ' + response.status + ' ' + response.statusText);
            }
            const csvText = await response.text();
            parseCsv(csvText);
            await fetchFileSizes();
            populateAudioSelector();
        } catch (error) {
            console.error('メタデータの読み込みに失敗しました:', error);
            setStatus('メタデータの読み込みに失敗しました。');
        }
    }

    function parseCsv(csvText) {
        const lines = csvText.trim().split('\n');
        // 1行目はヘッダー
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const [filename, title, speakerName, date, images] = line.split(',');
            state.metadata[filename] = {
                title: title,
                speaker: speakerName,
                recordedDate: date,
                // 画像列は「|」区切りで複数指定可。未指定なら空配列。
                images: images ? images.trim().split('|').map(s => s.trim()).filter(Boolean) : [],
            };
            state.files.push(filename);
        }
    }

    async function fetchFileSizes() {
        await Promise.all(state.files.map(async (filename) => {
            try {
                const res = await fetch(AUDIO_DIR + filename, { method: 'HEAD' });
                if (!res.ok) return;
                const size = res.headers.get('Content-Length');
                if (!size) return;
                const sizeBytes = Number(size);
                if (Number.isFinite(sizeBytes)) {
                    state.metadata[filename].fileSizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
                }
            } catch (e) {
                // ファイルサイズ取得失敗時は表示しない
            }
        }));
    }

    function populateAudioSelector() {
        dom.audioSelect.innerHTML = '';

        // 先頭にプレースホルダーを表示し、起動時は音声を自動ダウンロードしない
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '音声を選択してください';
        dom.audioSelect.appendChild(placeholder);

        state.files.forEach((filename) => {
            const option = document.createElement('option');
            option.value = filename;
            const meta = state.metadata[filename];
            option.textContent = meta.title + (meta.fileSizeMB ? ' [' + meta.fileSizeMB + 'MB]' : '');
            dom.audioSelect.appendChild(option);
        });

        // ユーザーが任意で選択するまでダウンロードしないため、ここでは自動選択しない
        // 音声未選択の間は再生系ボタンを無効化しておく
        dom.audioSelect.value = '';
        setControlsEnabled(false);
        setStatus('');
    }

    // --- 音声切り替え ---
    function changeAudio(filename) {
        state.currentFile = filename;
        dom.audioSource.src = AUDIO_DIR + filename;
        dom.audio.load();

        setControlsEnabled(true);
        updateAudioInfo();
        updateImageButton();
        setStatus('');
        updatePlayPauseButton();
        clearLoopRange();
        resetSpeed();
    }

    // --- 関連画像（台本）ビューア ---
    function updateImageButton() {
        const meta = state.metadata[state.currentFile];
        const images = (meta && meta.images) || [];
        state.currentImages = images;
        dom.imageButtonContainer.hidden = images.length === 0;
    }

    function openImageModal() {
        if (state.currentImages.length === 0) return;
        state.imageIndex = 0;
        renderImage();
        dom.imageModal.hidden = false;
    }

    function closeImageModal() {
        dom.imageModal.hidden = true;
        dom.imageModalImg.classList.remove('zoomed');
    }

    function renderImage() {
        const total = state.currentImages.length;
        const src = state.currentImages[state.imageIndex];
        dom.imageModalImg.src = src;
        dom.imageModalImg.classList.remove('zoomed');
        dom.imageModalViewport.scrollTop = 0;
        dom.imageModalViewport.scrollLeft = 0;
        dom.imageModalCounter.textContent = (state.imageIndex + 1) + ' / ' + total;
        // 画像が1枚だけのときは前後ボタンを隠す
        dom.imageModalNav.hidden = total <= 1;
        dom.imagePrevBtn.disabled = state.imageIndex === 0;
        dom.imageNextBtn.disabled = state.imageIndex === total - 1;
    }

    function showPrevImage() {
        if (state.imageIndex > 0) {
            state.imageIndex--;
            renderImage();
        }
    }

    function showNextImage() {
        if (state.imageIndex < state.currentImages.length - 1) {
            state.imageIndex++;
            renderImage();
        }
    }

    function updateAudioInfo() {
        const meta = state.metadata[state.currentFile];
        if (meta) {
            dom.audioTitle.textContent = meta.title;
            dom.speaker.textContent = meta.speaker;
            dom.recordedDate.textContent = meta.recordedDate;
        } else {
            dom.audioTitle.textContent = '音声情報';
            dom.speaker.textContent = '-';
            dom.recordedDate.textContent = '-';
        }
    }

    // --- 再生制御 ---
    function togglePlayPause() {
        if (dom.audio.paused) {
            dom.audio.play();
        } else {
            dom.audio.pause();
        }
    }

    function rewind() {
        dom.audio.currentTime = Math.max(0, dom.audio.currentTime - REWIND_SECONDS);
        setStatus(REWIND_SECONDS + '秒巻き戻しました');
    }

    function updatePlayPauseButton() {
        dom.playPauseBtn.textContent = dom.audio.paused ? '▶ 再生' : '一時停止';
    }

    // --- ループ範囲 ---
    function setLoopStart() {
        state.loopStart = dom.audio.currentTime;
        // 開始点が終了点以降なら終了点をクリア
        if (state.loopEnd !== null && state.loopStart >= state.loopEnd) {
            state.loopEnd = null;
        }
        updateLoopRangeDisplay();
        setStatus('開始点を ' + formatTime(state.loopStart) + ' に設定しました');
    }

    function setLoopEnd() {
        if (state.loopStart !== null && dom.audio.currentTime <= state.loopStart) {
            setStatus('終了点は開始点より後に設定してください');
            return;
        }
        state.loopEnd = dom.audio.currentTime;
        if (state.loopStart === null) {
            state.loopStart = 0;
        }
        updateLoopRangeDisplay();
        setStatus('終了点を ' + formatTime(state.loopEnd) + ' に設定しました');
    }

    function clearLoopRange() {
        state.loopStart = null;
        state.loopEnd = null;
        updateLoopRangeDisplay();
    }

    function updateLoopRangeDisplay() {
        if (state.loopStart !== null && state.loopEnd !== null) {
            dom.loopRangeDisplay.textContent =
                formatTime(state.loopStart) + ' → ' + formatTime(state.loopEnd) + ' をループ中';
        } else if (state.loopStart !== null) {
            dom.loopRangeDisplay.textContent =
                formatTime(state.loopStart) + ' → （終了点を設定してください）';
        } else {
            dom.loopRangeDisplay.textContent = '全体をループ再生';
        }
    }

    function enforceLoop() {
        if (state.loopStart !== null && state.loopEnd !== null &&
            dom.audio.currentTime >= state.loopEnd) {
            dom.audio.currentTime = state.loopStart;
        }
    }

    // --- 再生速度 ---
    function setSpeed(speed, button) {
        dom.audio.playbackRate = speed;
        dom.speedButtons.forEach(b => b.classList.remove('active'));
        if (button) button.classList.add('active');
        setStatus('再生速度: ' + speed + 'x');
    }

    function resetSpeed() {
        dom.audio.playbackRate = DEFAULT_SPEED;
        dom.speedButtons.forEach(b => b.classList.remove('active'));
        const defaultBtn = document.querySelector('.speed-button[data-speed="' + DEFAULT_SPEED + '"]');
        if (defaultBtn) defaultBtn.classList.add('active');
    }

    // --- イベント登録 ---
    function bindEvents() {
        dom.audioSelect.addEventListener('change', (e) => {
            if (!e.target.value) return; // プレースホルダー選択時は何もしない
            changeAudio(e.target.value);
        });

        dom.playPauseBtn.addEventListener('click', togglePlayPause);
        dom.rewindBtn.addEventListener('click', rewind);

        dom.loopStartBtn.addEventListener('click', setLoopStart);
        dom.loopEndBtn.addEventListener('click', setLoopEnd);
        dom.loopClearBtn.addEventListener('click', () => {
            clearLoopRange();
            setStatus('ループ範囲を解除しました（全体ループ）');
        });

        dom.speedButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                setSpeed(parseFloat(btn.dataset.speed), btn);
            });
        });

        // 関連画像（台本）ビューア
        dom.imageViewBtn.addEventListener('click', openImageModal);
        dom.imageModalClose.addEventListener('click', closeImageModal);
        dom.imagePrevBtn.addEventListener('click', showPrevImage);
        dom.imageNextBtn.addEventListener('click', showNextImage);
        // 画像タップで拡大・縮小をトグル
        dom.imageModalImg.addEventListener('click', () => {
            dom.imageModalImg.classList.toggle('zoomed');
        });
        // 背景（画像以外）のタップで閉じる
        dom.imageModalViewport.addEventListener('click', (e) => {
            if (e.target === dom.imageModalViewport) closeImageModal();
        });
        // Esc キーで閉じる
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !dom.imageModal.hidden) closeImageModal();
        });

        dom.audio.addEventListener('timeupdate', enforceLoop);
        dom.audio.addEventListener('play', () => {
            setStatus('再生中...');
            updatePlayPauseButton();
        });
        dom.audio.addEventListener('pause', () => {
            if (dom.audio.currentTime < dom.audio.duration) {
                setStatus('一時停止中');
            }
            updatePlayPauseButton();
        });
    }

    // --- 初期化 ---
    window.addEventListener('DOMContentLoaded', () => {
        bindEvents();
        // メタデータ読み込み・音声選択が済むまで再生系ボタンを無効化
        setControlsEnabled(false);
        loadAudioMetadata();
    });
})();
