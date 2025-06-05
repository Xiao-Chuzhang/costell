// autoplay.js
document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素引用
    const canvas = document.getElementById('gameCanvas');
    const scoreDisplay = document.getElementById('score');
    const comboDisplay = document.getElementById('combo');
    const judgmentTextDisplay = document.getElementById('judgment-text');
    const startButton = document.getElementById('start-button');
    const resultsOverlay = document.getElementById('results-overlay');
    const finalScoreDisplay = document.getElementById('final-score-display');
    const fullComboText = document.getElementById('full-combo-text');

    // --- AUTOPLAY CONFIG ---
    const AUTOPLAY_ENABLED = true; // 设置为 true 开启自动播放
    // -----------------------

    if (!checkCoreDOMElementsInitially()) {
        const errorMsg = "游戏初始化失败：关键界面元素缺失。";
        console.error(errorMsg);
        displayFatalError(errorMsg + " 请检查HTML结构或联系开发者。");
        return;
    }

    let ctx = null;

    // 音频管理
    let audioContext = null;
    let hitSoundBuffer = null;
    let backgroundMusicBuffer = null;
    let bgmSourceNode = null;
    let bgmPlaying = false;
    let bgmStartTimeInAudioContext = 0;
    let bgmStartOffset = 0;
    let bgmLoadingPromise = null;
    let chartDataPromise = null;

    // 游戏常量
    const NUM_TRACKS = 15;
    let CANVAS_WIDTH = 0, CANVAS_HEIGHT = 0, TRACK_WIDTH = 0;
    const NOTE_FIXED_HEIGHT = 20;
    let JUDGMENT_LINE_Y = 0;
    const JUDGMENT_LINE_HEIGHT = 5, JUDGMENT_LINE_Y_OFFSET_FROM_BOTTOM = 80;
    const EXCELLENT_WINDOW = 80, BAD_WINDOW = 150;
    const NOTE_FALL_SPEED_PPS = 980;
    const MIN_BPM = 10, MAX_BPM = 1000;
    const FLICK_BASE_SCORE = 500;
    const FLICK_SMALL_COLORS = { fill:'#00aaff',stroke:'#00eaff',trailBaseR:0,trailBaseG:170,trailBaseB:255};
    const FLICK_LARGE_COLORS = { fill:'#ff00aa',stroke:'#ff55cc',trailBaseR:255,trailBaseG:0,trailBaseB:170};
    const COLOR_BACKGROUND_STR = '#0a0a1e', COLOR_JUDGMENT_LINE_STR = '#00ffff';
    const TRAIL_SEGMENTS = 6, TRAIL_MAX_ALPHA = 0.35, TRAIL_ALPHA_DECAY_RATE = 0.88;
    const FEEDBACK_DURATION = 300, FEEDBACK_MAX_HEIGHT_FACTOR = 0.9;
    const JUDGMENT_TEXT_DURATION = 800;
    const SAFETY_TIMEOUT_LAST_NOTE = 10000;
    const SAFETY_TIMEOUT_EMPTY_CHART = 3 * 60 * 1000;
    const AUDIO_SYNC_TIMEOUT = 3500;
    const AUDIO_SYNC_THRESHOLD_MS = 50;
    const MIN_INITIAL_WAIT_MS = 3000;

    let tempChartData = null;

    // 游戏状态变量
    let isPlaying = false;
    let gameTimeSource = 'performance';
    let audioSysTimeAnchor = 0, audioMusicTimeAnchor = 0;
    let gameLogicStartTime = 0;
    let currentTime = 0;
    let score = 0, combo = 0, nextNoteUID = 0;
    let processedNotes = [];
    let activeTrackFeedbacks = [];
    let totalNotesInChart = 0;
    let isFullComboPossible = true; // Autoplay 模式下应始终为 true
    let animationFrameId = null;
    let judgmentTimeoutId = null;
    let gameShouldEndByMusic = false;
    let judgmentLineR = 0, judgmentLineG = 255, judgmentLineB = 255;
    let isWaitingForAudio = false;
    let pageLoadTime = 0;
    let startAttemptInProgress = false;

    // --- 辅助函数 ---
    function displayFatalError(message) {
        let errorOverlay = document.getElementById('fatal-error-overlay');
        if (!errorOverlay) {
            errorOverlay = document.createElement('div');
            errorOverlay.id = 'fatal-error-overlay';
            Object.assign(errorOverlay.style, {
                position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
                backgroundColor: 'rgba(0,0,0,0.85)', color: 'white',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                zIndex: '10000', textAlign: 'center', padding: '20px', boxSizing: 'border-box',
                fontFamily: 'sans-serif'
            });
            const errorMessageElement = document.createElement('p');
            errorMessageElement.id = 'fatal-error-message';
            errorMessageElement.style.fontSize = '1.2em';
            errorMessageElement.style.marginBottom = '20px';
            errorOverlay.appendChild(errorMessageElement);
            
            const refreshButton = document.createElement('button');
            refreshButton.textContent = '刷新页面';
            refreshButton.onclick = () => window.location.reload();
            Object.assign(refreshButton.style, {
                padding: '10px 20px', fontSize: '1em', cursor: 'pointer',
                backgroundColor: '#337ab7', color: 'white', border: 'none', borderRadius: '5px'
            });
            errorOverlay.appendChild(refreshButton);
            document.body.appendChild(errorOverlay);
        }
        const msgElem = errorOverlay.querySelector('#fatal-error-message') || errorOverlay.firstChild;
        if (msgElem) msgElem.textContent = message;
        errorOverlay.style.display = 'flex';
    }

    function checkCoreDOMElementsInitially() {
        const elements = { canvas, scoreDisplay, comboDisplay, judgmentTextDisplay, startButton, resultsOverlay, finalScoreDisplay, fullComboText };
        for (const key in elements) {
            if (!elements[key]) return false;
        }
        return true;
    }

    function updateGameDimensions() {
        CANVAS_WIDTH = window.innerWidth;
        CANVAS_HEIGHT = window.innerHeight;
        if (canvas) {
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
        }
        TRACK_WIDTH = (NUM_TRACKS > 0 && CANVAS_WIDTH > 0) ? CANVAS_WIDTH / NUM_TRACKS : 0;
        JUDGMENT_LINE_Y = CANVAS_HEIGHT - JUDGMENT_LINE_Y_OFFSET_FROM_BOTTOM - (JUDGMENT_LINE_HEIGHT / 2);
        
        if (!isFinite(TRACK_WIDTH) || TRACK_WIDTH <= 0) {
            console.warn(`游戏尺寸警告：音轨宽度无效 (W: ${TRACK_WIDTH}, CW: ${CANVAS_WIDTH}, NT: ${NUM_TRACKS})。`);
            TRACK_WIDTH = CANVAS_WIDTH > 0 ? CANVAS_WIDTH / (NUM_TRACKS > 0 ? NUM_TRACKS : 15) : 50;
            if (TRACK_WIDTH <=0) TRACK_WIDTH = 1;
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => { timeout = null; func.apply(context, args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function onWindowResize() {
        updateGameDimensions();
        if (!isPlaying && ctx) clearCanvasAndDrawStatic();
    }
    
    function handleMusicEndedInternal() {
        bgmPlaying = false;
        if (bgmSourceNode) bgmSourceNode.onended = null;
        if (isPlaying) {
            gameShouldEndByMusic = true;
            // console.debug("音频事件：BGM播放结束。"); // Autoplay时可减少此类输出
        }
    }

    function getBGMCurrentTimeSeconds() {
        if (bgmPlaying && audioContext && backgroundMusicBuffer && bgmSourceNode) {
            let elapsedSinceSourceStart = audioContext.currentTime - bgmStartTimeInAudioContext;
            let currentTimeSeconds = bgmStartOffset + elapsedSinceSourceStart;
            return Math.max(0, Math.min(currentTimeSeconds, backgroundMusicBuffer.duration));
        }
        return bgmStartOffset;
    }

    function playBackgroundMusic(offset = 0) {
        if (!audioContext || !backgroundMusicBuffer) {
            console.warn("音频系统：BGM播放前置条件不足。");
            isWaitingForAudio = false; gameTimeSource = 'performance';
            if (totalNotesInChart === 0) gameShouldEndByMusic = true;
            return false;
        }

        if (bgmSourceNode) {
            bgmSourceNode.onended = null;
            try { if (bgmPlaying) bgmSourceNode.stop(0); } catch(e) { /* मौन */ }
            bgmSourceNode.disconnect(); bgmSourceNode = null;
        }

        bgmSourceNode = audioContext.createBufferSource();
        bgmSourceNode.buffer = backgroundMusicBuffer;
        bgmSourceNode.loop = false;
        bgmSourceNode.connect(audioContext.destination);
        bgmSourceNode.onended = handleMusicEndedInternal;

        bgmStartOffset = Math.max(0, Math.min(offset, backgroundMusicBuffer.duration));
        if (bgmStartOffset >= backgroundMusicBuffer.duration && backgroundMusicBuffer.duration > 0) {
            bgmPlaying = false;
            if (typeof bgmSourceNode.onended === 'function') {
                setTimeout(() => { if(bgmSourceNode && typeof bgmSourceNode.onended === 'function') bgmSourceNode.onended() }, 0);
            }
            return false;
        }

        try {
            bgmStartTimeInAudioContext = audioContext.currentTime;
            bgmSourceNode.start(0, bgmStartOffset);
            bgmPlaying = true;
            return true;
        } catch (e) {
            console.error("音频系统：播放BGM时发生错误。", e);
            bgmPlaying = false; isWaitingForAudio = false; gameTimeSource = 'performance';
            if (totalNotesInChart === 0) gameShouldEndByMusic = true;
            return false;
        }
    }

    function stopBackgroundMusic() {
        if (bgmSourceNode && bgmPlaying) {
            bgmStartOffset = getBGMCurrentTimeSeconds(); 
            bgmSourceNode.onended = null;
            try { bgmSourceNode.stop(0); } catch(e) { /* मौन */ }
            bgmSourceNode.disconnect();
        }
        bgmPlaying = false;
    }
    
    function initAudio() {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (audioContext.state === 'suspended') {
                    audioContext.resume().catch(e => console.warn("音频警告：AudioContext 初始恢复失败。", e.message));
                }
            } else if (audioContext.state === 'suspended') {
                 audioContext.resume().catch(e => console.warn("音频警告：AudioContext 已存在但被挂起，尝试恢复失败。", e.message));
            }

            const loadAudioBuffer = (url) => { // 移除了 isBGM 参数，因为错误处理逻辑一致
                return fetch(url)
                    .then(response => {
                        if (!response.ok) {
                            const error = new Error(`HTTP错误 ${response.status} 加载 ${url}`);
                            error.status = response.status; throw error;
                        }
                        return response.arrayBuffer();
                    })
                    .then(arrayBuffer => {
                        if (!audioContext) throw new Error("AudioContext未初始化，无法解码。");
                        return audioContext.decodeAudioData(arrayBuffer);
                    })
                    .catch(error => {
                        console.error(`音频错误：加载或解码 ${url} 失败:`, error.message);
                        return null;
                    });
            };
            
            bgmLoadingPromise = loadAudioBuffer('song.mp3').then(buffer => {
                backgroundMusicBuffer = buffer;
                if (!buffer) console.error("音频系统：BGM 'song.mp3' 加载或解码失败。");
                return buffer;
            });

            loadAudioBuffer('sound.mp3').then(buffer => {
                hitSoundBuffer = buffer;
                if (!buffer) console.warn("音频系统：打击音效 'sound.mp3' 加载或解码失败。");
            });

        } catch (error) {
            console.error("初始化AudioContext或音频加载时发生严重错误。", error);
            displayFatalError("音频系统初始化失败。游戏可能无法正常运行。");
        }
    }

    async function attemptToStartGame() {
        if (isPlaying || startAttemptInProgress) return;
        startAttemptInProgress = true;
        
        const startButtonText = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real";
        if (startButton) { startButton.disabled = true; startButton.textContent = "LOADING..."; }

        try {
            const chart = await chartDataPromise;
            if (!chart) throw new Error("谱面数据加载失败。");
            
            if (audioContext && audioContext.state === 'suspended') {
                try { await audioContext.resume(); } catch (e) {
                    console.warn("开始游戏前激活 AudioContext 失败。", e.message);
                }
            }
            
            if (bgmLoadingPromise) {
                if (startButton) startButton.textContent = "COMPOSING...";
                const buffer = await bgmLoadingPromise;
                if (!buffer) {
                    const bgmErrorMsg = "错误: 背景音乐加载失败。\n请检查网络和控制台错误，然后刷新重试。";
                    alert(bgmErrorMsg); throw new Error("BGM加载失败。");
                }
            } else {
                const criticalErrorMsg = "严重错误: 音频加载逻辑未初始化。";
                alert(criticalErrorMsg + "\n请刷新页面。"); throw new Error(criticalErrorMsg);
            }

            const currentTimeMs = performance.now();
            const elapsedTimeSinceLoad = currentTimeMs - pageLoadTime;
            if (elapsedTimeSinceLoad < MIN_INITIAL_WAIT_MS) {
                const remainingWait = MIN_INITIAL_WAIT_MS - elapsedTimeSinceLoad;
                if (startButton) startButton.textContent = `WAITING... (${Math.ceil(remainingWait/1000)}s)`;
                await new Promise(resolve => setTimeout(resolve, remainingWait));
            }
            
            startGameInternal();

        } catch (error) {
            console.error("尝试启动游戏过程中发生错误:", error.message);
            if (startButton && !document.getElementById('fatal-error-overlay')?.style.display?.includes('flex')) {
                startButton.disabled = false; startButton.textContent = startButtonText;
            }
        } finally {
            startAttemptInProgress = false;
        }
    }

    function init() {
        pageLoadTime = performance.now(); 

        if (canvas) {
            ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) {
                displayFatalError("初始化错误：无法获取Canvas 2D渲染上下文。"); return;
            }
        } else { return; }

        chartDataPromise = fetch('chart.json') // 确保谱面文件名正确
            .then(response => {
                if (!response.ok) throw new Error(`谱面文件加载失败: ${response.status}`);
                return response.json();
            })
            .then(data => {
                tempChartData = data; return data;
            })
            .catch(error => {
                console.error("加载或解析谱面数据时发生错误:", error.message);
                tempChartData = null;
                displayFatalError("谱面数据加载失败，游戏无法启动。");
                return null;
            });

        initAudio();
        updateGameDimensions();

        if (startButton) {
            startButton.addEventListener('click', attemptToStartGame);
            if (AUTOPLAY_ENABLED) {
                // 可选：在Autoplay模式下，让开始按钮直接触发，或自动开始
                // startButton.click(); // 例如，页面加载后自动点击开始
                 // 或者直接在init末尾调用 attemptToStartGame，如果希望无按钮自动开始
            }
        }

        // Autoplay 模式下禁用玩家输入事件的注册
        if (!AUTOPLAY_ENABLED) {
            if (document) document.addEventListener('keydown', handleKeyPress);
            if (canvas) {
                canvas.addEventListener('mousedown', handleMouseDown);
                canvas.addEventListener('touchstart', handleTouchStart, { passive: false }); 
            }
        } else {
            console.info("Autoplay模式已激活，玩家输入已禁用。");
        }
        
        if (window) window.addEventListener('resize', debounce(onWindowResize, 250));


        try {
            if (typeof COLOR_JUDGMENT_LINE_STR === 'string') {
                const match = COLOR_JUDGMENT_LINE_STR.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                if (match) {
                    judgmentLineR = parseInt(match[1], 16); judgmentLineG = parseInt(match[2], 16); judgmentLineB = parseInt(match[3], 16);
                } else {
                    console.warn(`初始化警告：判定线颜色 '${COLOR_JUDGMENT_LINE_STR}' 格式无效。`);
                    judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255;
                }
            } else {
                 console.warn(`初始化警告：判定线颜色配置不是字符串。`);
                 judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255;
            }
        } catch (e) { 
            console.error("解析判定线颜色时发生错误。", e); 
            judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255;
        }

        if (ctx) clearCanvasAndDrawStatic(); 
        if (startButton) {
            startButton.textContent = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real";
            startButton.style.cssText = "top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 1; visibility: visible;";
            startButton.disabled = false;
        }
    }

    function startGameInternal() {
        if (!ctx) {
            console.error("游戏启动中止：Canvas渲染上下文丢失。");
            if (startButton) { startButton.disabled = false; startButton.textContent = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real"; startButton.style.cssText = "top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 1; visibility: visible;"; }
            return;
        }
        updateGameDimensions();

        gameShouldEndByMusic = false;
        isWaitingForAudio = !!(audioContext && backgroundMusicBuffer); 
        gameTimeSource = 'performance';

        if (CANVAS_WIDTH <= 0 || CANVAS_HEIGHT <= 0 || TRACK_WIDTH <= 0 || !isFinite(TRACK_WIDTH)) {
            alert("错误：游戏区域尺寸无效。");
            if (startButton) { startButton.disabled = false; startButton.textContent = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real"; startButton.style.display = 'block';}
            return;
        }
        if (!tempChartData || typeof tempChartData.bpm !== 'number' || tempChartData.bpm < MIN_BPM || tempChartData.bpm > MAX_BPM || !Array.isArray(tempChartData.notes)) {
            alert("错误：谱面数据格式不正确或BPM范围错误。");
            if (startButton) { startButton.disabled = false; startButton.textContent = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real"; startButton.style.display = 'block';}
            return;
        }
        if (!audioContext || !backgroundMusicBuffer) {
            alert("错误：音频资源未能成功初始化或加载。\n请刷新页面。");
            if (startButton) { startButton.disabled = false; startButton.textContent = AUTOPLAY_ENABLED ? "GO !!!" : "GO! (in real"; startButton.style.display = 'block';}
            return;
        }

        if (resultsOverlay) resultsOverlay.classList.add('hidden');
        if (fullComboText) { fullComboText.classList.add('hidden'); fullComboText.classList.remove('flicker'); }
        if (startButton) { startButton.style.cssText = "opacity: 0; visibility: hidden;"; startButton.disabled = true; }

        isPlaying = true;
        score = 0; combo = 0; nextNoteUID = 0; activeTrackFeedbacks = [];
        isFullComboPossible = true; // Autoplay 总是 FC
        totalNotesInChart = 0;
        currentTime = 0; bgmStartOffset = 0;

        updateScoreDisplay(); updateComboDisplay(); setJudgmentText('', '');
        processChartData(tempChartData);
        totalNotesInChart = processedNotes.length;

        if (processedNotes.length === 0 && tempChartData.notes.length > 0) {
            console.warn("警告：谱面所有音符数据均无效或无法解析。");
        } else if (processedNotes.length === 0) {
            console.info("提示：谱面为空（无音符）。");
        }

        gameLogicStartTime = performance.now();
        const bgmStarted = playBackgroundMusic(0);
        if (!bgmStarted && backgroundMusicBuffer) {
             console.error("游戏启动错误：BGM播放失败。");
             isWaitingForAudio = false; gameTimeSource = 'performance';
             if (totalNotesInChart === 0) gameShouldEndByMusic = true; 
        }
        
        if (isWaitingForAudio) {
            setTimeout(() => {
                if (isWaitingForAudio && isPlaying) {
                    console.warn("音频同步警告：等待BGM同步超时。回退到系统时间。");
                    isWaitingForAudio = false; gameTimeSource = 'performance';
                }
            }, AUDIO_SYNC_TIMEOUT);
        }

        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        gameLoop();
    }

    function processChartData(chartData) {
        if (!chartData || typeof chartData.bpm !== 'number' || !Array.isArray(chartData.notes)) {
            console.error("谱面处理错误：谱面数据结构无效。", chartData);
            processedNotes = []; return;
        }
        const msPerBeat = (60 / chartData.bpm) * 1000;
        if (!isFinite(msPerBeat) || msPerBeat <= 0) {
            console.error("谱面处理错误：BPM值无效。", chartData.bpm);
            processedNotes = []; return;
        }

        processedNotes = chartData.notes.map((noteData, index) => {
            if (typeof noteData !== 'object' || noteData === null) {
                 console.warn(`谱面警告：音符 #${index} 不是对象。已忽略。`); return null;
            }
            if (typeof noteData.beat !== 'number' || !isFinite(noteData.beat) || noteData.beat < 0) {
                console.warn(`谱面警告：音符 #${index} 'beat'无效(${noteData.beat})。已忽略.`); return null;
            }
            if (typeof noteData.track === 'undefined') {
                console.warn(`谱面警告：音符 #${index} 缺少 'track'。已忽略.`); return null;
            }

            const isLarge = Array.isArray(noteData.track);
            let startTrack, endTrack;

            if (isLarge) {
                if (noteData.track.length !== 2 || typeof noteData.track[0] !== 'number' || typeof noteData.track[1] !== 'number' ||
                    !isFinite(noteData.track[0]) || !isFinite(noteData.track[1])) {
                    console.warn(`谱面警告：大型音符 #${index} 'track'格式无效(${JSON.stringify(noteData.track)})。已忽略.`); return null;
                }
                startTrack = Math.min(noteData.track[0], noteData.track[1]); endTrack = Math.max(noteData.track[0], noteData.track[1]);
            } else {
                if (typeof noteData.track !== 'number' || !isFinite(noteData.track)) {
                    console.warn(`谱面警告：单轨音符 #${index} 'track'格式无效(${noteData.track})。已忽略.`); return null;
                }
                startTrack = noteData.track; endTrack = noteData.track;
            }

            if (startTrack < 1 || endTrack > NUM_TRACKS || startTrack > endTrack) {
                console.warn(`谱面警告：音符 #${index} 音轨号[${startTrack}-${endTrack}]超出范围[1-${NUM_TRACKS}]。已忽略.`); return null;
            }

            return {
                id: `note-${nextNoteUID++}`, time: noteData.beat * msPerBeat,
                trackInfo: { start: startTrack, end: endTrack }, isLarge: isLarge,
                isHit: false, isMissed: false, // Autoplay 会将 isHit 设为 true
                currentY: 0, width: 0, x: 0,
                trail: Array.from({ length: TRAIL_SEGMENTS }, () => ({ y: 0, alpha: 0 })),
                colors: isLarge ? FLICK_LARGE_COLORS : FLICK_SMALL_COLORS,
                autoPlayed: false // 新增：标记此音符是否已被Autoplay处理
            };
        }).filter(note => note !== null);
    }

    // --- 绘图函数 (与之前版本基本一致) ---
    function clearCanvasAndDrawStatic() { if (!ctx) return; ctx.fillStyle = COLOR_BACKGROUND_STR; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); drawCyberpunkBackground(); }
    function drawCyberpunkBackground() { if (!ctx || TRACK_WIDTH <= 0 || CANVAS_WIDTH <= 0 || CANVAS_HEIGHT <= 0) return; ctx.strokeStyle = `rgba(${judgmentLineR}, ${judgmentLineG}, ${judgmentLineB}, 0.05)`; ctx.lineWidth = 0.5; for (let y = 0; y < CANVAS_HEIGHT; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(CANVAS_WIDTH, y + 0.5); ctx.stroke(); } if (FLICK_LARGE_COLORS) {ctx.strokeStyle = `rgba(${FLICK_LARGE_COLORS.trailBaseR}, ${FLICK_LARGE_COLORS.trailBaseG}, ${FLICK_LARGE_COLORS.trailBaseB}, 0.03)`; for (let i = 1; i < NUM_TRACKS; i++) { const x = i * TRACK_WIDTH; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CANVAS_HEIGHT); ctx.stroke(); }} }
    function drawJudgmentLine() { if (!ctx || CANVAS_WIDTH <=0) return; ctx.fillStyle = COLOR_JUDGMENT_LINE_STR; ctx.shadowBlur = 15; ctx.shadowColor = COLOR_JUDGMENT_LINE_STR; ctx.fillRect(0, JUDGMENT_LINE_Y - JUDGMENT_LINE_HEIGHT / 2, CANVAS_WIDTH, JUDGMENT_LINE_HEIGHT); ctx.shadowBlur = 0; }
    function drawNote(note) { if (!ctx || !note || !note.colors || TRACK_WIDTH <=0) return; const trackSpan = note.trackInfo.end - note.trackInfo.start + 1; const gap = trackSpan > 1 ? Math.min(4, TRACK_WIDTH * 0.05) : Math.min(2, TRACK_WIDTH * 0.05); note.width = trackSpan * TRACK_WIDTH - gap; note.x = (note.trackInfo.start - 1) * TRACK_WIDTH + gap / 2; if (note.width <= 0) return; const noteTopY = note.currentY - NOTE_FIXED_HEIGHT / 2; ctx.fillStyle = note.colors.fill; ctx.strokeStyle = note.colors.stroke; ctx.lineWidth = 1.5; ctx.shadowColor = note.colors.fill; ctx.shadowBlur = 10; ctx.beginPath(); ctx.rect(Math.floor(note.x), Math.floor(noteTopY), Math.ceil(note.width), NOTE_FIXED_HEIGHT); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0; }
    function updateAndDrawFlickTrail(note) { if (!ctx || !note || !note.trail || !note.colors || NOTE_FIXED_HEIGHT <=0 || TRAIL_SEGMENTS <=0) return; const { trailBaseR, trailBaseG, trailBaseB } = note.colors; for (let i = TRAIL_SEGMENTS - 1; i > 0; i--) { note.trail[i].y = note.trail[i-1].y; note.trail[i].alpha = note.trail[i-1].alpha; } note.trail[0].y = note.currentY + NOTE_FIXED_HEIGHT / 2 + 1; note.trail[0].alpha = TRAIL_MAX_ALPHA; let originalGlobalAlpha = ctx.globalAlpha; for (let i = 0; i < TRAIL_SEGMENTS; i++) { const segment = note.trail[i]; if (segment.alpha <= 0.01) continue; const segmentHeight = NOTE_FIXED_HEIGHT * (1 - (i / TRAIL_SEGMENTS) * 0.5); const currentSegmentAlpha = segment.alpha * (1 - i / (TRAIL_SEGMENTS + 1)); if (currentSegmentAlpha <= 0.01 || segmentHeight <=0) continue; ctx.globalAlpha = currentSegmentAlpha; ctx.fillStyle = `rgb(${trailBaseR}, ${trailBaseG}, ${trailBaseB})`; ctx.fillRect(Math.floor(note.x), Math.floor(segment.y - segmentHeight / 2), Math.ceil(note.width), Math.ceil(segmentHeight)); segment.alpha *= TRAIL_ALPHA_DECAY_RATE; } ctx.globalAlpha = originalGlobalAlpha; }
    function drawTrackFeedbacks() { if (!ctx || activeTrackFeedbacks.length === 0 || TRACK_WIDTH <=0) return; const now = currentTime; let lastFeedbackColorKey = null; let originalGlobalAlpha = ctx.globalAlpha; let originalShadowBlur = ctx.shadowBlur; activeTrackFeedbacks = activeTrackFeedbacks.filter(feedback => { if (!feedback) return false; const elapsedTime = now - feedback.timeHit; if (elapsedTime > feedback.duration) return false; const progress = elapsedTime / feedback.duration; const alpha = Math.pow(1 - progress, 2) * 0.75; if (alpha <= 0.01) return true; const { r, g, b, trackIndex } = feedback; const trackX = (trackIndex - 1) * TRACK_WIDTH; const peakHeight = JUDGMENT_LINE_Y * FEEDBACK_MAX_HEIGHT_FACTOR; const currentHeight = Math.max(0, progress < 0.4 ? peakHeight * (progress / 0.4) : peakHeight * (1 - (progress - 0.4) / 0.6)); if (currentHeight <=0) return true; const effectY = JUDGMENT_LINE_Y - currentHeight; ctx.globalAlpha = alpha; ctx.fillStyle = `rgb(${r}, ${g}, ${b})`; const feedbackColorKey = `${r}-${g}-${b}`; if (lastFeedbackColorKey !== feedbackColorKey) { ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.7)`; ctx.shadowBlur = 20; lastFeedbackColorKey = feedbackColorKey; } ctx.fillRect(Math.floor(trackX), Math.floor(effectY), Math.ceil(TRACK_WIDTH), Math.ceil(currentHeight)); return true; }); ctx.globalAlpha = originalGlobalAlpha; ctx.shadowBlur = originalShadowBlur; }


    // --- 游戏主循环 ---
    function gameLoop() {
        if (!isPlaying) {
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            animationFrameId = null; return;
        }

        const nowSys = performance.now();
        if (gameTimeSource === 'audio' && audioContext && backgroundMusicBuffer && bgmPlaying) {
            currentTime = audioMusicTimeAnchor + (nowSys - audioSysTimeAnchor);
        } else {
            currentTime = nowSys - gameLogicStartTime;
            if (gameTimeSource === 'audio' && (!bgmPlaying || !audioContext || !backgroundMusicBuffer)) {
                console.warn("音频系统：BGM停止/资源丢失，时间源切换回系统性能时间。");
                gameTimeSource = 'performance'; gameLogicStartTime = nowSys - currentTime;
            }
        }

        if (isWaitingForAudio && audioContext && backgroundMusicBuffer && bgmPlaying) {
             const currentBgmTimeMs = getBGMCurrentTimeSeconds() * 1000;
             if (currentBgmTimeMs >= AUDIO_SYNC_THRESHOLD_MS) {
                audioSysTimeAnchor = performance.now(); audioMusicTimeAnchor = currentBgmTimeMs;
                gameTimeSource = 'audio'; isWaitingForAudio = false;
                currentTime = audioMusicTimeAnchor; gameLogicStartTime = audioSysTimeAnchor - audioMusicTimeAnchor;
             }
        }
        if (isWaitingForAudio && gameTimeSource === 'performance') {
            currentTime = Math.min(currentTime, AUDIO_SYNC_TIMEOUT * 0.6); 
        }

        // Autoplay: 检查并触发音符
        if (AUTOPLAY_ENABLED) {
            checkAndTriggerAutoplayNotes();
        }


        if (ctx) {
            clearCanvasAndDrawStatic(); drawJudgmentLine();
            const notesToDrawThisFrame = [];
            if (processedNotes && processedNotes.length > 0) {
                for (let i = 0; i < processedNotes.length; i++) {
                    const note = processedNotes[i];
                    if (!note || note.isHit || (!AUTOPLAY_ENABLED && note.isMissed)) {
                        // 对于已击中或已错过的音符，确保其拖尾也被清除（尽管在判定时已经清过一次，这里是保险）
                        if (note && note.trail) {
                            note.trail.forEach(t => t.alpha = 0);
                        }
                        continue; // 跳过此音符的后续处理和绘制
                    }
                    
                    note.currentY = JUDGMENT_LINE_Y - ((note.time - currentTime) / 1000) * NOTE_FALL_SPEED_PPS;
                    if (note.isHit && AUTOPLAY_ENABLED) { // Autoplay击中后，让它继续下落一小段再消失
                         if (note.currentY < JUDGMENT_LINE_Y - NOTE_FIXED_HEIGHT * 3) continue; // 最终消失点
                    }


                    if (note.currentY < CANVAS_HEIGHT + NOTE_FIXED_HEIGHT * 3 && note.currentY > -NOTE_FIXED_HEIGHT * 6) {
                        notesToDrawThisFrame.push(note);
                    } else if (note.currentY < -NOTE_FIXED_HEIGHT * 6) { 
                        if (note.trail) note.trail.forEach(t => t.alpha = 0); 
                    }
                }
            }
            for (let i = 0; i < notesToDrawThisFrame.length; i++) updateAndDrawFlickTrail(notesToDrawThisFrame[i]);
            for (let i = 0; i < notesToDrawThisFrame.length; i++) drawNote(notesToDrawThisFrame[i]);
            
            if (!AUTOPLAY_ENABLED) { // Autoplay模式下不需要检查玩家是否错过
                checkMissedNotes(); 
            }
            drawTrackFeedbacks();
        }

        // 游戏结束条件
        let shouldEndGameNow = false; let endReason = "";
        if (gameShouldEndByMusic) {
            shouldEndGameNow = true; endReason = "BGM播放完毕";
        } else {
            const allNotesDone = totalNotesInChart > 0 && processedNotes.every(n => (AUTOPLAY_ENABLED ? n.autoPlayed : (n.isHit || n.isMissed)));
            const bgmEffectivelyOver = (!bgmPlaying && backgroundMusicBuffer && 
                                     (getBGMCurrentTimeSeconds() >= backgroundMusicBuffer.duration - 0.1 || 
                                      (bgmStartOffset >= backgroundMusicBuffer.duration && backgroundMusicBuffer.duration > 0)));
            if (allNotesDone && (!audioContext || !backgroundMusicBuffer || bgmEffectivelyOver)) {
                shouldEndGameNow = true; endReason = "所有音符完成且BGM结束/无法播放";
            } else if (totalNotesInChart === 0 && (!audioContext || !backgroundMusicBuffer || bgmEffectivelyOver || (backgroundMusicBuffer && backgroundMusicBuffer.duration < 1))) {
                shouldEndGameNow = true; endReason = "空谱面且BGM结束/无法播放/过短";
            } else if (totalNotesInChart > 0 && processedNotes.length > 0) {
                const lastNoteTime = processedNotes[processedNotes.length - 1]?.time;
                if (typeof lastNoteTime === 'number' && currentTime > lastNoteTime + (AUTOPLAY_ENABLED ? 0 : BAD_WINDOW) + SAFETY_TIMEOUT_LAST_NOTE) { // Autoplay时最后一个音符判定后即可计时
                    shouldEndGameNow = true; endReason = "安全超时：末尾音符后无活动";
                }
            } else if (totalNotesInChart === 0 && audioContext && backgroundMusicBuffer && !bgmEffectivelyOver && currentTime > SAFETY_TIMEOUT_EMPTY_CHART) {
                shouldEndGameNow = true; endReason = "安全超时：空谱面游戏时长超限";
            }
        }

        if (shouldEndGameNow) { endGame(endReason); return; }
        animationFrameId = requestAnimationFrame(gameLoop);
    }

    // --- Autoplay专属逻辑 ---
    function checkAndTriggerAutoplayNotes() {
        if (!processedNotes || processedNotes.length === 0) return;

        for (let i = 0; i < processedNotes.length; i++) {
            const note = processedNotes[i];
            // 如果音符未被击中(isHit)，未被自动播放过(autoPlayed)，并且当前时间到达或略微超过音符的精确时间
            if (note && !note.isHit && !note.autoPlayed && currentTime >= note.time) {
                simulatePerfectHit(note);
                note.autoPlayed = true; // 标记为已由Autoplay处理
            }
        }
    }

    function simulatePerfectHit(note) {
        if (!note || note.isHit) return; // 再次检查，防止重复处理

        note.isHit = true; // 标记为已击中
        if (note.trail) note.trail.forEach(t => t.alpha = 0); // 清除拖尾

        // 播放打击音效 (与handleGameInput中的逻辑类似)
        if (audioContext && hitSoundBuffer) {
            if (audioContext.state === 'suspended') audioContext.resume().catch(e => console.warn("AudioContext Autoplay时恢复失败:", e.message));
            if (audioContext.state === 'running') {
                try {
                    const source = audioContext.createBufferSource();
                    source.buffer = hitSoundBuffer; source.connect(audioContext.destination); source.start(0);
                } catch (e) { console.error("Autoplay播放打击音效出错:", e.message); }
            }
        }

        // 更新分数和连击
        const trackSpan = note.trackInfo.end - note.trackInfo.start + 1;
        score += FLICK_BASE_SCORE * trackSpan;
        combo++;
        isFullComboPossible = true; // Autoplay下总是FC

        updateScoreDisplay();
        updateComboDisplay();
        setJudgmentText('EXCELLENT', 'excellent'); // Autoplay总是EXCELLENT

        // 添加音轨反馈效果
        if (note.colors) {
            const { trailBaseR, trailBaseG, trailBaseB } = note.colors;
            for (let j = note.trackInfo.start; j <= note.trackInfo.end; j++) {
                activeTrackFeedbacks.push({ trackIndex: j, timeHit: currentTime, duration: FEEDBACK_DURATION, r: trailBaseR, g: trailBaseG, b: trailBaseB });
            }
        }
        // console.debug(`Autoplay: 音符ID '${note.id}' 在 ${currentTime.toFixed(0)}ms (目标: ${note.time.toFixed(0)}ms) 被完美击中。`);
    }


    // --- 游戏逻辑 (手动模式) ---
    function handleGameInput() { // 此函数在Autoplay模式下不会被调用
        if (!isPlaying || !ctx || AUTOPLAY_ENABLED) return;
        if (audioContext && hitSoundBuffer) {
            if (audioContext.state === 'suspended') audioContext.resume().catch(e => console.warn("AudioContext输入时恢复失败:", e.message));
            if (audioContext.state === 'running') {
                try {
                    const source = audioContext.createBufferSource();
                    source.buffer = hitSoundBuffer; source.connect(audioContext.destination); source.start(0);
                } catch (e) { console.error("播放打击音效出错:", e.message); }
            }
        }
        judgeFlick();
    }

    function handleKeyPress(event) { if (!event || !isPlaying || event.repeat || typeof event.key !== 'string' || AUTOPLAY_ENABLED) return; if (!(event.key.length === 1 && /^[a-zA-Z]$/.test(event.key))) return; handleGameInput(); }
    function handleMouseDown(event) { if (!event || event.button !== 0 || !isPlaying || AUTOPLAY_ENABLED) return; handleGameInput(); }
    function handleTouchStart(event) { if (!event || !isPlaying || AUTOPLAY_ENABLED) return; event.preventDefault(); if (event.changedTouches && event.changedTouches.length > 0) { for (let i = 0; i < event.changedTouches.length; i++) handleGameInput(); } }

    function checkMissedNotes() { // Autoplay模式下不应调用此函数
        if (!processedNotes || processedNotes.length === 0 || AUTOPLAY_ENABLED) return;
        for (let i = 0; i < processedNotes.length; i++) {
            const note = processedNotes[i];
            if (!note || note.isHit || note.isMissed) continue;
            if (currentTime > note.time + BAD_WINDOW) {
                note.isMissed = true; combo = 0; isFullComboPossible = false;
                updateComboDisplay(); setJudgmentText('MISS', 'miss');
            }
        }
    }

    function judgeFlick() { // Autoplay模式下不应调用此函数
        if (!processedNotes || processedNotes.length === 0 || AUTOPLAY_ENABLED) return;
        let excellentCandidate = null, badCandidate = null;

        for (let i = processedNotes.length - 1; i >= 0; i--) {
            const note = processedNotes[i];
            if (!note || note.isHit || note.isMissed) continue;
            const timeDiff = note.time - currentTime;
            if (timeDiff > BAD_WINDOW + 50 || timeDiff < -(BAD_WINDOW + 200)) continue;

            const absTimeDiff = Math.abs(timeDiff);
            if (absTimeDiff <= EXCELLENT_WINDOW) {
                if (!excellentCandidate || absTimeDiff < Math.abs(excellentCandidate.note.time - currentTime)) {
                    excellentCandidate = { note, type: 'EXCELLENT', timeDiff };
                }
            } else if (absTimeDiff <= BAD_WINDOW) {
                if (!badCandidate || absTimeDiff < Math.abs(badCandidate.note.time - currentTime)) {
                    badCandidate = { note, type: 'BAD', timeDiff };
                }
            }
        }

        const judged = excellentCandidate || badCandidate; 
        if (judged) {
            const { note: judgedNote, type: judgmentType } = judged; // timeDiff is available if needed
            if (judgedNote.isHit) { console.warn(`警告：尝试重复判定音符 ID '${judgedNote.id}'。`); return; }

            judgedNote.isHit = true;
            if (judgedNote.trail) judgedNote.trail.forEach(t => t.alpha = 0);
            const trackSpan = judgedNote.trackInfo.end - judgedNote.trackInfo.start + 1;
            let flickScore = 0;

            if (judgmentType === 'EXCELLENT') {
                flickScore = FLICK_BASE_SCORE * trackSpan; setJudgmentText('EXCELLENT', 'excellent');
                if (judgedNote.colors) {
                    const { trailBaseR, trailBaseG, trailBaseB } = judgedNote.colors;
                    for (let i = judgedNote.trackInfo.start; i <= judgedNote.trackInfo.end; i++) {
                        activeTrackFeedbacks.push({ trackIndex: i, timeHit: currentTime, duration: FEEDBACK_DURATION, r: trailBaseR, g: trailBaseG, b: trailBaseB });
                    }
                }
                combo++;
            } else { // BAD
                flickScore = Math.floor((FLICK_BASE_SCORE * trackSpan) * 0.2); setJudgmentText('BAD', 'bad');
                combo = 0; isFullComboPossible = false;
            }
            score += flickScore; updateScoreDisplay(); updateComboDisplay();
        }
    }

    function updateScoreDisplay() { if (scoreDisplay) scoreDisplay.textContent = String(score); }
    function updateComboDisplay() { if (comboDisplay) comboDisplay.textContent = String(combo); }

    function setJudgmentText(text, typeClass) {
        if (judgmentTimeoutId) clearTimeout(judgmentTimeoutId);
        if (!judgmentTextDisplay) return;
        judgmentTextDisplay.textContent = text;
        judgmentTextDisplay.className = (typeof typeClass === 'string' && typeClass) ? `judgment-${typeClass}` : ''; 
        const container = judgmentTextDisplay.parentElement;
        if (container) container.className = 'info-item judgment-display';

        if (text) {
            judgmentTimeoutId = setTimeout(() => {
                if (judgmentTextDisplay && judgmentTextDisplay.textContent === text) { 
                    judgmentTextDisplay.textContent = ''; judgmentTextDisplay.className = '';
                    if (container) container.className = 'info-item judgment-display';
                }
            }, JUDGMENT_TEXT_DURATION);
        }
    }

    // --- 游戏结束 ---
    function endGame(reason = "未知原因") {
        if (!isPlaying && animationFrameId === null) return;
        console.info(`游戏结束 (${AUTOPLAY_ENABLED ? "Autoplay模式" : "手动模式"})。原因：${reason}`);

        isPlaying = false; gameShouldEndByMusic = false;
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
        stopBackgroundMusic();
        if (judgmentTimeoutId) { clearTimeout(judgmentTimeoutId); judgmentTimeoutId = null; }
        setJudgmentText('', ''); 
        activeTrackFeedbacks = [];

        if (finalScoreDisplay) finalScoreDisplay.textContent = String(score);
        if (fullComboText && processedNotes) {
            // Autoplay 模式下，如果所有音符都被 autoPlayed，则视为 FC
            const allNotesProcessedForAutoplay = AUTOPLAY_ENABLED ? processedNotes.every(n => n && n.autoPlayed) : false;
            const allNotesHitManually = !AUTOPLAY_ENABLED ? processedNotes.every(n => n && n.isHit) : false;
            
            const showFC = totalNotesInChart > 0 && (
                (AUTOPLAY_ENABLED && allNotesProcessedForAutoplay && isFullComboPossible) || 
                (!AUTOPLAY_ENABLED && allNotesHitManually && isFullComboPossible)
            );
            
            fullComboText.classList.toggle('hidden', !showFC);
            fullComboText.classList.toggle('flicker', showFC);
            if (showFC) console.info("Full Combo!");
        }
        if (resultsOverlay) resultsOverlay.classList.remove('hidden');
        if (startButton) {
            startButton.textContent = AUTOPLAY_ENABLED ? "PLAY AGAIN!" : "PLAY AGAIN (in real";
            startButton.style.cssText = "top: 80%; left: 50%; transform: translate(-50%, -50%); opacity: 1; visibility: visible;";
            startButton.disabled = false;
        }
    }

    init();
});