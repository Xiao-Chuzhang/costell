// core.js
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
    const speedSelectorContainer = document.getElementById('speed-selector-container'); 
    const speedSlider = document.getElementById('speed-slider'); 
    const speedValueDisplay = document.getElementById('speed-value-display'); 

    // 检查核心DOM元素是否存在，防止后续操作因元素缺失而报错
    if (!checkCoreDOMElementsInitially()) {
        const errorMsg = "游戏初始化失败：关键界面元素缺失。";
        console.error(errorMsg);
        displayFatalError(errorMsg + " 请检查HTML结构或联系开发者。");
        return;
    }

    let ctx = null; // Canvas 2D渲染上下文

    // 音频管理相关变量
    let audioContext = null; // Web Audio API 上下文
    let hitSoundBuffer = null; // 打击音效的音频缓冲
    let backgroundMusicBuffer = null; // 背景音乐的音频缓冲
    let bgmSourceNode = null; // BGM的音频源节点
    let bgmPlaying = false; // BGM是否正在播放
    let bgmStartTimeInAudioContext = 0; // BGM在AudioContext时间轴上的开始时间
    let bgmStartOffset = 0; // BGM实际开始播放的偏移量（秒）
    let bgmLoadingPromise = null; // BGM加载的Promise对象
    let chartDataPromise = null; // 谱面数据加载的Promise对象

    // 游戏常量定义
    const NUM_TRACKS = 15; // 音轨数量
    let CANVAS_WIDTH = 0, CANVAS_HEIGHT = 0, TRACK_WIDTH = 0; // 画布与音轨尺寸
    const NOTE_FIXED_HEIGHT = 20; // Note的固定高度
    let JUDGMENT_LINE_Y = 0; // 判定线的Y坐标
    const JUDGMENT_LINE_HEIGHT = 5; // 判定线的高度
    let JUDGMENT_LINE_Y_OFFSET_FROM_BOTTOM = 80; // 判定线距离底部的偏移量，将在JS中动态调整

    const EXCELLENT_WINDOW = 80, BAD_WINDOW = 150; // 判定窗口 (毫秒)
    let NOTE_FALL_SPEED_PPS = 980; // Note下落速度 (像素/秒)，允许在游戏中调整
    const MIN_BPM = 30, MAX_BPM = 300; // 谱面BPM有效范围
    const FLICK_BASE_SCORE = 500; // Flick类型Note的基础分数
    // Flick Note颜色配置
    const FLICK_SMALL_COLORS = { fill:'#00aaff',stroke:'#00eaff',trailBaseR:0,trailBaseG:170,trailBaseB:255};
    const FLICK_LARGE_COLORS = { fill:'#ff00aa',stroke:'#ff55cc',trailBaseR:255,trailBaseG:0,trailBaseB:170};
    const COLOR_BACKGROUND_STR = '#0a0a1e', COLOR_JUDGMENT_LINE_STR = '#00ffff'; // 背景与判定线颜色
    // Note尾迹效果参数
    const TRAIL_SEGMENTS = 6, TRAIL_MAX_ALPHA = 0.35, TRAIL_ALPHA_DECAY_RATE = 0.88;
    // 音轨反馈效果参数
    const FEEDBACK_DURATION = 300, FEEDBACK_MAX_HEIGHT_FACTOR = 0.9;
    const JUDGMENT_TEXT_DURATION = 500; // 判定文本显示时长 (毫秒)
    // 游戏结束安全超时设置
    const SAFETY_TIMEOUT_LAST_NOTE = 10000; // 最后一个Note判定后，若BGM未结束，等待此时间后结束游戏 (毫秒)
    const SAFETY_TIMEOUT_EMPTY_CHART = 3 * 60 * 1000; // 空谱面游戏最大时长 (毫秒)
    // 音频同步相关参数
    const AUDIO_SYNC_TIMEOUT = 3500; // 等待音频同步的最大时长 (毫秒)
    const AUDIO_SYNC_THRESHOLD_MS = 50; // 音频时间与系统时间差异在此阈值内才切换时间源 (毫秒)
    const MIN_INITIAL_WAIT_MS = 3000; // 页面加载后，至少等待此时间才能开始游戏 (毫秒)，确保资源加载

    let tempChartData = null; // 临时存储加载的谱面数据

    // 游戏状态变量
    let isPlaying = false; // 游戏是否正在进行
    let gameTimeSource = 'performance'; // 游戏时间源: 'performance' (基于performance.now()) 或 'audio' (基于AudioContext.currentTime)
    let audioSysTimeAnchor = 0, audioMusicTimeAnchor = 0; // 音频时间与系统时间锚点，用于同步
    let gameLogicStartTime = 0; // 游戏逻辑开始的系统时间戳
    let currentTime = 0; // 游戏主时间线 (毫秒)
    let score = 0, combo = 0, nextNoteUID = 0; // 分数、连击、下一个Note的唯一ID
    let processedNotes = []; // 处理后的谱面Note数据
    let activeTrackFeedbacks = []; // 当前活跃的音轨反馈效果
    let totalNotesInChart = 0; // 谱面中有效Note总数
    let isFullComboPossible = true; // 是否仍有可能达成Full Combo
    let animationFrameId = null; // requestAnimationFrame的ID
    let judgmentTimeoutId = null; // 判定文本显示计时器ID
    let gameShouldEndByMusic = false; // 标记是否应由BGM结束事件触发游戏结束
    let judgmentLineR = 0, judgmentLineG = 255, judgmentLineB = 255; // 判定线RGB颜色分量
    let isWaitingForAudio = false; // 是否正在等待音频同步
    let pageLoadTime = 0; // 页面加载完成的时间戳
    let startAttemptInProgress = false; // 是否正在尝试开始游戏（防止重复点击）

    // --- 辅助函数 ---

    // 显示致命错误信息并提供刷新按钮
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

    // 初始化时检查核心DOM元素是否存在
    function checkCoreDOMElementsInitially() {
        const elements = { canvas, scoreDisplay, comboDisplay, judgmentTextDisplay, startButton, resultsOverlay, finalScoreDisplay, fullComboText, speedSelectorContainer, speedSlider, speedValueDisplay }; 
        for (const key in elements) {
            if (!elements[key]) {
                console.error(`核心DOM元素缺失: ${key}`);
                return false;
            }
        }
        return true;
    }

    // 更新游戏区域尺寸和相关布局参数
    function updateGameDimensions() {
        CANVAS_WIDTH = window.innerWidth;
        CANVAS_HEIGHT = window.innerHeight;
        if (canvas) {
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
        }
        TRACK_WIDTH = (NUM_TRACKS > 0 && CANVAS_WIDTH > 0) ? CANVAS_WIDTH / NUM_TRACKS : 0;
        
        // 动态计算判定线距离底部的偏移量，使其在矮屏幕上更贴近底部
        const preferredOffsetVH = CANVAS_HEIGHT * 0.10; // 10% 的视口高度作为首选
        const minOffsetPx = 30; // 最小30像素偏移
        const maxOffsetPx = 100; // 最大100像素偏移
        JUDGMENT_LINE_Y_OFFSET_FROM_BOTTOM = Math.max(minOffsetPx, Math.min(preferredOffsetVH, maxOffsetPx));

        JUDGMENT_LINE_Y = CANVAS_HEIGHT - JUDGMENT_LINE_Y_OFFSET_FROM_BOTTOM - (JUDGMENT_LINE_HEIGHT / 2);
        
        // 确保音轨宽度有效
        if (!isFinite(TRACK_WIDTH) || TRACK_WIDTH <= 0) {
            console.warn(`游戏尺寸警告：音轨宽度无效 (W: ${TRACK_WIDTH}, CW: ${CANVAS_WIDTH}, NT: ${NUM_TRACKS})。`);
            TRACK_WIDTH = CANVAS_WIDTH > 0 ? CANVAS_WIDTH / (NUM_TRACKS > 0 ? NUM_TRACKS : 15) : 50;
            if (TRACK_WIDTH <=0) TRACK_WIDTH = 1; // 最小宽度为1，防止除零等错误
        }
    }

    // 防抖函数，用于处理resize等频繁触发的事件
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => { timeout = null; func.apply(context, args); };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 窗口大小改变时的处理函数
    function onWindowResize() {
        updateGameDimensions();
        if (!isPlaying && ctx) clearCanvasAndDrawStatic(); // 非游戏状态下重绘静态背景
    }
    
    // BGM播放结束时的内部处理函数
    function handleMusicEndedInternal() {
        bgmPlaying = false;
        if (bgmSourceNode) bgmSourceNode.onended = null; // 清除事件回调，防止重复触发
        if (isPlaying) {
            gameShouldEndByMusic = true; // 标记游戏应由BGM结束触发
            console.debug("音频事件：BGM播放结束。");
        }
    }

    // 获取BGM当前播放时间 (秒)
    function getBGMCurrentTimeSeconds() {
        if (bgmPlaying && audioContext && backgroundMusicBuffer && bgmSourceNode) {
            let elapsedSinceSourceStart = audioContext.currentTime - bgmStartTimeInAudioContext;
            let currentTimeSeconds = bgmStartOffset + elapsedSinceSourceStart;
            return Math.max(0, Math.min(currentTimeSeconds, backgroundMusicBuffer.duration)); // 确保时间在有效范围内
        }
        return bgmStartOffset; // 若未播放，则返回开始偏移量
    }

    // 播放背景音乐
    function playBackgroundMusic(offset = 0) {
        if (!audioContext || !backgroundMusicBuffer) {
            console.warn("音频系统：BGM播放前置条件不足 (AudioContext 或 Buffer缺失)。");
            isWaitingForAudio = false; gameTimeSource = 'performance'; // 回退到性能时间源
            if (totalNotesInChart === 0) gameShouldEndByMusic = true; // 空谱面时，BGM无法播放则直接结束
            return false;
        }

        // 如果已存在BGM源节点，先停止并断开连接
        if (bgmSourceNode) {
            bgmSourceNode.onended = null;
            try { if (bgmPlaying) bgmSourceNode.stop(0); } catch(e) { /* 静默处理，节点可能已停止 */ }
            bgmSourceNode.disconnect(); bgmSourceNode = null;
        }

        // 创建新的BGM源节点
        bgmSourceNode = audioContext.createBufferSource();
        bgmSourceNode.buffer = backgroundMusicBuffer;
        bgmSourceNode.loop = false; // 不循环播放
        bgmSourceNode.connect(audioContext.destination);
        bgmSourceNode.onended = handleMusicEndedInternal; // 绑定结束事件

        // 设置播放偏移量，并确保在有效范围内
        bgmStartOffset = Math.max(0, Math.min(offset, backgroundMusicBuffer.duration));
        if (bgmStartOffset >= backgroundMusicBuffer.duration && backgroundMusicBuffer.duration > 0) {
            console.warn(`音频系统：尝试从音乐末尾 (${bgmStartOffset.toFixed(2)}s) 开始播放，将不会实际播放。`);
            bgmPlaying = false;
            if (typeof bgmSourceNode.onended === 'function') { // 手动触发结束事件
                setTimeout(() => { if(bgmSourceNode && typeof bgmSourceNode.onended === 'function') bgmSourceNode.onended() }, 0);
            }
            return false;
        }

        try {
            bgmStartTimeInAudioContext = audioContext.currentTime; // 记录AudioContext时间轴上的开始点
            bgmSourceNode.start(0, bgmStartOffset); // 从指定偏移量开始播放
            bgmPlaying = true;
            return true;
        } catch (e) {
            console.error("音频系统：播放BGM时发生错误。", e);
            bgmPlaying = false; isWaitingForAudio = false; gameTimeSource = 'performance';
            if (totalNotesInChart === 0) gameShouldEndByMusic = true;
            return false;
        }
    }

    // 停止背景音乐
    function stopBackgroundMusic() {
        if (bgmSourceNode && bgmPlaying) {
            bgmStartOffset = getBGMCurrentTimeSeconds(); // 保存当前播放位置，以便后续可能恢复
            bgmSourceNode.onended = null; // 清除结束回调
            try { bgmSourceNode.stop(0); } catch(e) { /* 静默处理 */ }
            bgmSourceNode.disconnect();
        }
        bgmPlaying = false;
    }
    
    // 初始化音频系统 (AudioContext, 加载音效和BGM)
    function initAudio() {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (audioContext.state === 'suspended') { // 用户交互前AudioContext可能被挂起
                    audioContext.resume().catch(e => console.warn("音频警告：AudioContext 初始恢复失败。", e.message));
                }
            } else if (audioContext.state === 'suspended') { // 如果已存在但被挂起，也尝试恢复
                 audioContext.resume().catch(e => console.warn("音频警告：AudioContext 已存在但被挂起，尝试恢复失败。", e.message));
            }

            // 封装加载和解码音频缓冲的函数
            const loadAudioBuffer = (url, isBGM = false) => {
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
                        return null; // 返回null表示加载失败
                    });
            };
            
            // 加载BGM
            bgmLoadingPromise = loadAudioBuffer('song.mp3', true).then(buffer => {
                backgroundMusicBuffer = buffer; 
                if (!buffer) console.error("音频系统：BGM 'song.mp3' 加载或解码失败。");
                return buffer;
            });

            // 加载打击音效
            loadAudioBuffer('sound.mp3').then(buffer => {
                hitSoundBuffer = buffer;
                if (!buffer) console.warn("音频系统：打击音效 'sound.mp3' 加载或解码失败。");
            });

        } catch (error) {
            console.error("初始化AudioContext或音频加载时发生严重错误。", error);
            displayFatalError("音频系统初始化失败。游戏可能无法正常运行，请尝试刷新或更换浏览器。");
        }
    }

    // 初始化流速选择器
    function initSpeedSelector() {
        if (!speedSlider || !speedValueDisplay) return;

        let initialSpeedPPS;
        try { // 从localStorage读取上次保存的流速
            const storedSpeed = localStorage.getItem('costell3_noteSpeedPPS');
            if (storedSpeed !== null) {
                const parsedSpeed = parseInt(storedSpeed, 10);
                if (!isNaN(parsedSpeed) && parsedSpeed >= 100 && parsedSpeed <= 2000) { // 验证有效性
                    initialSpeedPPS = parsedSpeed;
                } else {
                    initialSpeedPPS = 980; // 无效则使用默认值
                    localStorage.removeItem('costell3_noteSpeedPPS'); // 移除无效存储
                }
            } else {
                initialSpeedPPS = 980; // 未存储则使用默认值
            }
        } catch (e) {
            console.warn("读取localStorage中的流速失败:", e);
            initialSpeedPPS = 980;
        }
        
        NOTE_FALL_SPEED_PPS = initialSpeedPPS;
        speedSlider.value = NOTE_FALL_SPEED_PPS / 10; // 滑块值与实际速度值的转换
        speedValueDisplay.textContent = `x${(NOTE_FALL_SPEED_PPS / 100).toFixed(1)}`; // 显示 xN.N 格式

        // 监听滑块输入事件，更新流速并保存到localStorage
        speedSlider.addEventListener('input', () => {
            const sliderValue = parseInt(speedSlider.value, 10);
            NOTE_FALL_SPEED_PPS = sliderValue * 10;
            speedValueDisplay.textContent = `x${(NOTE_FALL_SPEED_PPS / 100).toFixed(1)}`;
            try {
                localStorage.setItem('costell3_noteSpeedPPS', NOTE_FALL_SPEED_PPS.toString());
            } catch (e) {
                console.warn("保存流速到localStorage失败:", e);
            }
        });
    }

    // 尝试开始游戏（处理资源加载、用户交互等前置条件）
    async function attemptToStartGame() {
        if (isPlaying || startAttemptInProgress) return; // 防止重复启动
        startAttemptInProgress = true;
        
        if (startButton) { startButton.disabled = true; startButton.textContent = "LOADING..."; }

        try {
            // 等待谱面数据加载完成
            const chart = await chartDataPromise;
            if (!chart) throw new Error("谱面数据加载失败。"); 
            
            // 尝试恢复被挂起的AudioContext
            if (audioContext && audioContext.state === 'suspended') {
                try { await audioContext.resume(); } catch (e) {
                    console.warn("开始游戏前激活 AudioContext 失败。", e.message);
                }
            }
            
            // 等待BGM加载完成
            if (bgmLoadingPromise) {
                if (startButton) startButton.textContent = "COMPOSING..."; // 更新按钮文本提示
                const buffer = await bgmLoadingPromise;
                if (!buffer) { // BGM加载失败则提示错误并中断
                    const bgmErrorMsg = "错误: 背景音乐加载失败。\n请检查网络和控制台错误，然后刷新重试。";
                    alert(bgmErrorMsg); throw new Error("BGM加载失败。");
                }
            } else { // 严重错误：音频加载逻辑未初始化
                const criticalErrorMsg = "严重错误: 音频加载逻辑未初始化。";
                alert(criticalErrorMsg + "\n请刷新页面。"); throw new Error(criticalErrorMsg);
            }

            // 确保页面加载后有足够的等待时间，以允许浏览器处理资源
            const currentTimeMs = performance.now();
            const elapsedTimeSinceLoad = currentTimeMs - pageLoadTime;
            if (elapsedTimeSinceLoad < MIN_INITIAL_WAIT_MS) {
                const remainingWait = MIN_INITIAL_WAIT_MS - elapsedTimeSinceLoad;
                if (startButton) startButton.textContent = `WAITING... (${Math.ceil(remainingWait/1000)}s)`;
                await new Promise(resolve => setTimeout(resolve, remainingWait));
            }
            
            startGameInternal(); // 所有前置条件满足，正式开始游戏

        } catch (error) {
            console.error("尝试启动游戏过程中发生错误:", error.message);
            // 如果不是致命错误弹窗，则恢复开始按钮状态
            if (startButton && !document.getElementById('fatal-error-overlay')?.style.display?.includes('flex')) {
                startButton.disabled = false; startButton.textContent = "GO !!!";
            }
        } finally {
            startAttemptInProgress = false; // 重置尝试启动标记
        }
    }

    // 游戏初始化总入口
    function init() {
        pageLoadTime = performance.now(); // 记录页面加载时间

        // 获取Canvas渲染上下文
        if (canvas) {
            ctx = canvas.getContext('2d', { alpha: false }); // alpha:false 可提高性能
            if (!ctx) {
                displayFatalError("初始化错误：无法获取Canvas 2D渲染上下文。"); return;
            }
        } else { return; } // canvas不存在则无法继续

        // 加载谱面数据
        chartDataPromise = fetch('chart.json')
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
                displayFatalError("谱面加载失败，请检查网络。");
                return null;
            });
        
        initSpeedSelector(); // 初始化流速选择器
        initAudio(); // 初始化音频系统
        updateGameDimensions(); // 初始化游戏尺寸

        // 绑定事件监听器
        if (startButton) startButton.addEventListener('click', attemptToStartGame);
        if (document) document.addEventListener('keydown', handleKeyPress); // 键盘输入
        if (window) window.addEventListener('resize', debounce(onWindowResize, 250)); // 窗口大小调整（防抖）
        if (canvas) { // Canvas上的触摸/点击输入
            canvas.addEventListener('mousedown', handleMouseDown);
            canvas.addEventListener('touchstart', handleTouchStart, { passive: false }); // passive:false 允许preventDefault
        }

        // 解析判定线颜色字符串为RGB分量
        try {
            if (typeof COLOR_JUDGMENT_LINE_STR === 'string') {
                const match = COLOR_JUDGMENT_LINE_STR.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
                if (match) {
                    judgmentLineR = parseInt(match[1], 16); judgmentLineG = parseInt(match[2], 16); judgmentLineB = parseInt(match[3], 16);
                } else { // 颜色格式无效，使用默认值
                    console.warn(`初始化警告：判定线颜色 '${COLOR_JUDGMENT_LINE_STR}' 格式无效。`);
                    judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255;
                }
            } else { // 配置不是字符串，使用默认值
                 console.warn(`初始化警告：判定线颜色配置不是字符串。`);
                 judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255;
            }
        } catch (e) { 
            console.error("解析判定线颜色时发生错误。", e); 
            judgmentLineR = 0; judgmentLineG = 255; judgmentLineB = 255; // 出错则使用默认值
        }

        if (ctx) clearCanvasAndDrawStatic(); // 绘制初始静态背景
        // 显示开始按钮和流速选择器
        if (startButton) {
            startButton.textContent = "GO !!!";
            startButton.classList.remove('hidden'); 
            startButton.disabled = false;
        }
        if (speedSelectorContainer) {
            speedSelectorContainer.classList.remove('hidden'); 
        }
    }

    // 实际开始游戏逻辑
    function startGameInternal() {
        if (!ctx) { // Canvas上下文丢失则无法开始
            console.error("游戏启动中止：Canvas渲染上下文丢失。");
            if (startButton) { startButton.disabled = false; startButton.textContent = "GO !!!"; startButton.classList.remove('hidden'); }
            if (speedSelectorContainer) speedSelectorContainer.classList.remove('hidden');
            return;
        }
        updateGameDimensions(); // 确保游戏开始前尺寸是最新的

        gameShouldEndByMusic = false; // 重置BGM结束标记
        isWaitingForAudio = !!(audioContext && backgroundMusicBuffer); // 如果音频资源存在，则等待同步
        gameTimeSource = 'performance'; // 初始时间源为性能时间

        // 验证游戏区域尺寸和谱面数据
        if (CANVAS_WIDTH <= 0 || CANVAS_HEIGHT <= 0 || TRACK_WIDTH <= 0 || !isFinite(TRACK_WIDTH)) {
            alert("错误：游戏区域尺寸无效。请调整窗口或刷新。");
            if (startButton) { startButton.disabled = false; startButton.textContent = "GO !!!"; startButton.classList.remove('hidden');}
            if (speedSelectorContainer) speedSelectorContainer.classList.remove('hidden');
            return;
        }
        if (!tempChartData || typeof tempChartData.bpm !== 'number' || tempChartData.bpm < MIN_BPM || tempChartData.bpm > MAX_BPM || !Array.isArray(tempChartData.notes)) {
            alert("错误：谱面数据格式不正确或BPM范围错误。");
            if (startButton) { startButton.disabled = false; startButton.textContent = "GO !!!"; startButton.classList.remove('hidden');}
            if (speedSelectorContainer) speedSelectorContainer.classList.remove('hidden');
            return;
        }
        if (!audioContext || !backgroundMusicBuffer) { // 音频资源未加载成功
            alert("错误：音频资源未能成功初始化或加载。\n请刷新页面。");
            if (startButton) { startButton.disabled = false; startButton.textContent = "GO !!!"; startButton.classList.remove('hidden');}
            if (speedSelectorContainer) speedSelectorContainer.classList.remove('hidden');
            return;
        }

        // 隐藏UI元素（结算界面、开始按钮、流速选择器）
        if (resultsOverlay) resultsOverlay.classList.add('hidden');
        if (fullComboText) { fullComboText.classList.add('hidden'); fullComboText.classList.remove('flicker'); }
        if (startButton) { 
            startButton.classList.add('hidden');
            startButton.disabled = true; // 禁用按钮，防止游戏过程中误触
        }
        if (speedSelectorContainer) { 
            speedSelectorContainer.classList.add('hidden');
        }

        // 重置游戏状态变量
        isPlaying = true;
        score = 0; combo = 0; nextNoteUID = 0; activeTrackFeedbacks = [];
        isFullComboPossible = true; totalNotesInChart = 0;
        currentTime = 0; bgmStartOffset = 0;

        // 更新UI显示
        updateScoreDisplay(); updateComboDisplay(); setJudgmentText('', '');
        
        // 处理谱面数据
        processChartData(tempChartData);
        totalNotesInChart = processedNotes.length; // 记录谱面Note总数

        if (processedNotes.length === 0 && tempChartData.notes.length > 0) {
            console.warn("警告：谱面所有音符数据均无效或无法解析。");
        } else if (processedNotes.length === 0) {
            console.info("提示：谱面为空（无音符）。");
        }

        gameLogicStartTime = performance.now(); // 记录游戏逻辑开始时间
        const bgmStarted = playBackgroundMusic(0); // 尝试播放BGM
        if (!bgmStarted && backgroundMusicBuffer) { // BGM播放失败处理
             console.error("游戏启动错误：BGM播放失败（例如，从末尾播放）。");
             isWaitingForAudio = false; gameTimeSource = 'performance';
             if (totalNotesInChart === 0) gameShouldEndByMusic = true; 
        }
        
        // 如果需要等待音频同步，设置超时回退
        if (isWaitingForAudio) {
            setTimeout(() => {
                if (isWaitingForAudio && isPlaying) { // 超时仍未同步
                    console.warn("音频同步警告：等待BGM同步超时。回退到系统时间。");
                    isWaitingForAudio = false; gameTimeSource = 'performance';
                }
            }, AUDIO_SYNC_TIMEOUT);
        }

        if (animationFrameId) cancelAnimationFrame(animationFrameId); // 清除旧的动画帧
        gameLoop(); //启动游戏主循环
    }

    // 处理谱面数据，将其转换为游戏内部使用的Note对象格式
    function processChartData(chartData) {
        if (!chartData || typeof chartData.bpm !== 'number' || !Array.isArray(chartData.notes)) {
            console.error("谱面处理错误：谱面数据结构无效。", chartData);
            processedNotes = []; return;
        }
        const msPerBeat = (60 / chartData.bpm) * 1000; // 计算每拍的毫秒数
        if (!isFinite(msPerBeat) || msPerBeat <= 0) { // 验证BPM有效性
            console.error("谱面处理错误：BPM值无效。", chartData.bpm);
            processedNotes = []; return;
        }

        processedNotes = chartData.notes.map((noteData, index) => {
            // 验证Note数据基本结构
            if (typeof noteData !== 'object' || noteData === null) {
                 console.warn(`谱面警告：音符 #${index} 不是对象。已忽略。`); return null;
            }
            if (typeof noteData.beat !== 'number' || !isFinite(noteData.beat) || noteData.beat < 0) {
                console.warn(`谱面警告：音符 #${index} 'beat'无效(${noteData.beat})。已忽略.`); return null;
            }
            if (typeof noteData.track === 'undefined') {
                console.warn(`谱面警告：音符 #${index} 缺少 'track'。已忽略.`); return null;
            }

            const isLarge = Array.isArray(noteData.track); // 判断是否为长条Note
            let startTrack, endTrack;

            if (isLarge) { // 长条Note的轨道处理
                if (noteData.track.length !== 2 || typeof noteData.track[0] !== 'number' || typeof noteData.track[1] !== 'number' ||
                    !isFinite(noteData.track[0]) || !isFinite(noteData.track[1])) {
                    console.warn(`谱面警告：大型音符 #${index} 'track'格式无效(${JSON.stringify(noteData.track)})。已忽略.`); return null;
                }
                startTrack = Math.min(noteData.track[0], noteData.track[1]); endTrack = Math.max(noteData.track[0], noteData.track[1]);
            } else { // 单点Note的轨道处理
                if (typeof noteData.track !== 'number' || !isFinite(noteData.track)) {
                    console.warn(`谱面警告：单轨音符 #${index} 'track'格式无效(${noteData.track})。已忽略.`); return null;
                }
                startTrack = noteData.track; endTrack = noteData.track;
            }

            // 验证轨道号是否在有效范围内
            if (startTrack < 1 || endTrack > NUM_TRACKS || startTrack > endTrack) {
                console.warn(`谱面警告：音符 #${index} 音轨号[${startTrack}-${endTrack}]超出范围[1-${NUM_TRACKS}]。已忽略.`); return null;
            }

            // 返回处理后的Note对象
            return {
                id: `note-${nextNoteUID++}`, // 唯一ID
                time: noteData.beat * msPerBeat, // Note的触发时间 (毫秒)
                trackInfo: { start: startTrack, end: endTrack }, // 轨道信息
                isLarge: isLarge, // 是否为长条Note
                isHit: false, isMissed: false, // 判定状态
                currentY: 0, width: 0, x: 0, // 绘制相关属性
                trail: Array.from({ length: TRAIL_SEGMENTS }, () => ({ y: 0, alpha: 0 })), // 尾迹数据
                colors: isLarge ? FLICK_LARGE_COLORS : FLICK_SMALL_COLORS // 颜色配置
            };
        }).filter(note => note !== null); // 过滤掉无效的Note数据
    }

    // --- 绘图函数 ---
    // 清空画布并绘制静态背景元素
    function clearCanvasAndDrawStatic() { if (!ctx) return; ctx.fillStyle = COLOR_BACKGROUND_STR; ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); drawCyberpunkBackground(); }
    // 绘制赛博朋克风格的背景网格线
    function drawCyberpunkBackground() { if (!ctx || TRACK_WIDTH <= 0 || CANVAS_WIDTH <= 0 || CANVAS_HEIGHT <= 0) return; ctx.strokeStyle = `rgba(${judgmentLineR}, ${judgmentLineG}, ${judgmentLineB}, 0.05)`; ctx.lineWidth = 0.5; for (let y = 0; y < CANVAS_HEIGHT; y += 40) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(CANVAS_WIDTH, y + 0.5); ctx.stroke(); } if (FLICK_LARGE_COLORS) {ctx.strokeStyle = `rgba(${FLICK_LARGE_COLORS.trailBaseR}, ${FLICK_LARGE_COLORS.trailBaseG}, ${FLICK_LARGE_COLORS.trailBaseB}, 0.03)`; for (let i = 1; i < NUM_TRACKS; i++) { const x = i * TRACK_WIDTH; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, CANVAS_HEIGHT); ctx.stroke(); }} }
    // 绘制判定线
    function drawJudgmentLine() { if (!ctx || CANVAS_WIDTH <=0) return; ctx.fillStyle = COLOR_JUDGMENT_LINE_STR; ctx.shadowBlur = 15; ctx.shadowColor = COLOR_JUDGMENT_LINE_STR; ctx.fillRect(0, JUDGMENT_LINE_Y - JUDGMENT_LINE_HEIGHT / 2, CANVAS_WIDTH, JUDGMENT_LINE_HEIGHT); ctx.shadowBlur = 0; } // 绘制后清除阴影，避免影响其他元素
    // 绘制单个Note
    function drawNote(note) { if (!ctx || !note || !note.colors || TRACK_WIDTH <=0) return; const trackSpan = note.trackInfo.end - note.trackInfo.start + 1; const gap = trackSpan > 1 ? Math.min(4, TRACK_WIDTH * 0.05) : Math.min(2, TRACK_WIDTH * 0.05); note.width = trackSpan * TRACK_WIDTH - gap; note.x = (note.trackInfo.start - 1) * TRACK_WIDTH + gap / 2; if (note.width <= 0) return; const noteTopY = note.currentY - NOTE_FIXED_HEIGHT / 2; ctx.fillStyle = note.colors.fill; ctx.strokeStyle = note.colors.stroke; ctx.lineWidth = 1.5; ctx.shadowColor = note.colors.fill; ctx.shadowBlur = 10; ctx.beginPath(); ctx.rect(Math.floor(note.x), Math.floor(noteTopY), Math.ceil(note.width), NOTE_FIXED_HEIGHT); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0; }
    // 更新并绘制Note的尾迹效果
    function updateAndDrawFlickTrail(note) { if (!ctx || !note || !note.trail || !note.colors || NOTE_FIXED_HEIGHT <=0 || TRAIL_SEGMENTS <=0) return; const { trailBaseR, trailBaseG, trailBaseB } = note.colors; for (let i = TRAIL_SEGMENTS - 1; i > 0; i--) { note.trail[i].y = note.trail[i-1].y; note.trail[i].alpha = note.trail[i-1].alpha; } note.trail[0].y = note.currentY + NOTE_FIXED_HEIGHT / 2 + 1; note.trail[0].alpha = TRAIL_MAX_ALPHA; let originalGlobalAlpha = ctx.globalAlpha; for (let i = 0; i < TRAIL_SEGMENTS; i++) { const segment = note.trail[i]; if (segment.alpha <= 0.01) continue; const segmentHeight = NOTE_FIXED_HEIGHT * (1 - (i / TRAIL_SEGMENTS) * 0.5); const currentSegmentAlpha = segment.alpha * (1 - i / (TRAIL_SEGMENTS + 1)); if (currentSegmentAlpha <= 0.01 || segmentHeight <=0) continue; ctx.globalAlpha = currentSegmentAlpha; ctx.fillStyle = `rgb(${trailBaseR}, ${trailBaseG}, ${trailBaseB})`; ctx.fillRect(Math.floor(note.x), Math.floor(segment.y - segmentHeight / 2), Math.ceil(note.width), Math.ceil(segmentHeight)); segment.alpha *= TRAIL_ALPHA_DECAY_RATE; } ctx.globalAlpha = originalGlobalAlpha; } // 恢复全局透明度
    // 绘制音轨的反馈效果 (击中时的视觉反馈)
    function drawTrackFeedbacks() { if (!ctx || activeTrackFeedbacks.length === 0 || TRACK_WIDTH <=0) return; const now = currentTime; let lastFeedbackColorKey = null; let originalGlobalAlpha = ctx.globalAlpha; let originalShadowBlur = ctx.shadowBlur; activeTrackFeedbacks = activeTrackFeedbacks.filter(feedback => { if (!feedback) return false; const elapsedTime = now - feedback.timeHit; if (elapsedTime > feedback.duration) return false; const progress = elapsedTime / feedback.duration; const alpha = Math.pow(1 - progress, 2) * 0.75; if (alpha <= 0.01) return true; const { r, g, b, trackIndex } = feedback; const trackX = (trackIndex - 1) * TRACK_WIDTH; const peakHeight = JUDGMENT_LINE_Y * FEEDBACK_MAX_HEIGHT_FACTOR; const currentHeight = Math.max(0, progress < 0.4 ? peakHeight * (progress / 0.4) : peakHeight * (1 - (progress - 0.4) / 0.6)); if (currentHeight <=0) return true; const effectY = JUDGMENT_LINE_Y - currentHeight; ctx.globalAlpha = alpha; ctx.fillStyle = `rgb(${r}, ${g}, ${b})`; const feedbackColorKey = `${r}-${g}-${b}`; if (lastFeedbackColorKey !== feedbackColorKey) { ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.7)`; ctx.shadowBlur = 20; lastFeedbackColorKey = feedbackColorKey; } ctx.fillRect(Math.floor(trackX), Math.floor(effectY), Math.ceil(TRACK_WIDTH), Math.ceil(currentHeight)); return true; }); ctx.globalAlpha = originalGlobalAlpha; ctx.shadowBlur = originalShadowBlur; } // 恢复全局透明度和阴影

    // --- 游戏主循环 ---
    function gameLoop() {
        if (!isPlaying) { // 游戏未进行则停止循环
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            animationFrameId = null; return;
        }

        // 更新游戏时间
        const nowSys = performance.now();
        if (gameTimeSource === 'audio' && audioContext && backgroundMusicBuffer && bgmPlaying) { // 基于音频时间
            currentTime = audioMusicTimeAnchor + (nowSys - audioSysTimeAnchor);
        } else { // 基于性能时间
            currentTime = nowSys - gameLogicStartTime;
            // 如果之前是音频时间源但BGM停止或资源丢失，则回退到性能时间源
            if (gameTimeSource === 'audio' && (!bgmPlaying || !audioContext || !backgroundMusicBuffer)) {
                console.warn("音频系统：BGM停止/资源丢失，时间源切换回系统性能时间。");
                gameTimeSource = 'performance'; gameLogicStartTime = nowSys - currentTime; // 更新性能时间源的起始点
            }
        }

        // 如果正在等待音频同步，尝试切换时间源
        if (isWaitingForAudio && audioContext && backgroundMusicBuffer && bgmPlaying) {
             const currentBgmTimeMs = getBGMCurrentTimeSeconds() * 1000;
             if (currentBgmTimeMs >= AUDIO_SYNC_THRESHOLD_MS) { // BGM播放时间已达到同步阈值
                audioSysTimeAnchor = performance.now(); audioMusicTimeAnchor = currentBgmTimeMs; // 设置锚点
                gameTimeSource = 'audio'; isWaitingForAudio = false; // 切换到音频时间源
                currentTime = audioMusicTimeAnchor; gameLogicStartTime = audioSysTimeAnchor - audioMusicTimeAnchor; // 更新当前时间和性能时间源起始点
             }
        }
        // 如果正在等待音频同步但使用性能时间源，限制时间推进速度，防止Note过快下落
        if (isWaitingForAudio && gameTimeSource === 'performance') {
            currentTime = Math.min(currentTime, AUDIO_SYNC_TIMEOUT * 0.6); 
        }

        // 绘制游戏画面
        if (ctx) {
            clearCanvasAndDrawStatic(); // 清空并绘制背景和判定线
            drawJudgmentLine();
            const notesToDrawThisFrame = []; // 存储当前帧需要绘制的Note
            if (processedNotes && processedNotes.length > 0) {
                for (let i = 0; i < processedNotes.length; i++) {
                    const note = processedNotes[i];
                    if (!note || note.isHit || note.isMissed) continue; // 跳过已判定或无效的Note
                    // 计算Note当前Y坐标
                    note.currentY = JUDGMENT_LINE_Y - ((note.time - currentTime) / 1000) * NOTE_FALL_SPEED_PPS;
                    // 优化：只将可视范围内的Note加入绘制列表
                    if (note.currentY < CANVAS_HEIGHT + NOTE_FIXED_HEIGHT * 3 && note.currentY > -NOTE_FIXED_HEIGHT * 6) {
                        notesToDrawThisFrame.push(note);
                    } else if (note.currentY < -NOTE_FIXED_HEIGHT * 6) { // Note已完全移出屏幕上方，清除尾迹
                        if (note.trail) note.trail.forEach(t => t.alpha = 0); 
                    }
                }
            }
            // 先绘制尾迹，再绘制Note主体，确保Note在尾迹之上
            for (let i = 0; i < notesToDrawThisFrame.length; i++) updateAndDrawFlickTrail(notesToDrawThisFrame[i]);
            for (let i = 0; i < notesToDrawThisFrame.length; i++) drawNote(notesToDrawThisFrame[i]);
            
            checkMissedNotes(); // 检查是否有漏掉的Note
            drawTrackFeedbacks(); // 绘制音轨反馈
        }

        // 检查游戏结束条件
        let shouldEndGameNow = false; let endReason = "";
        if (gameShouldEndByMusic) { // BGM播放完毕触发
            shouldEndGameNow = true; endReason = "BGM播放完毕";
        } else {
            const allNotesDone = totalNotesInChart > 0 && processedNotes.every(n => n.isHit || n.isMissed); // 所有Note都已判定
            // BGM有效结束（停止播放且已到末尾，或BGM资源本身无效/过短）
            const bgmEffectivelyOver = (!bgmPlaying && backgroundMusicBuffer && 
                                     (getBGMCurrentTimeSeconds() >= backgroundMusicBuffer.duration - 0.1 || 
                                      (bgmStartOffset >= backgroundMusicBuffer.duration && backgroundMusicBuffer.duration > 0)));
            if (allNotesDone && (!audioContext || !backgroundMusicBuffer || bgmEffectivelyOver)) { // 所有Note完成且BGM结束/无法播放
                shouldEndGameNow = true; endReason = "所有音符完成且BGM结束/无法播放";
            } else if (totalNotesInChart === 0 && (!audioContext || !backgroundMusicBuffer || bgmEffectivelyOver || (backgroundMusicBuffer && backgroundMusicBuffer.duration < 1))) { // 空谱面且BGM结束/无法播放/过短
                shouldEndGameNow = true; endReason = "空谱面且BGM结束/无法播放/过短";
            } else if (totalNotesInChart > 0 && processedNotes.length > 0) { // 安全超时：最后一个Note后无活动
                const lastNoteTime = processedNotes[processedNotes.length - 1]?.time;
                if (typeof lastNoteTime === 'number' && currentTime > lastNoteTime + BAD_WINDOW + SAFETY_TIMEOUT_LAST_NOTE) {
                    shouldEndGameNow = true; endReason = "安全超时：末尾音符后无活动";
                }
            } else if (totalNotesInChart === 0 && audioContext && backgroundMusicBuffer && !bgmEffectivelyOver && currentTime > SAFETY_TIMEOUT_EMPTY_CHART) { // 安全超时：空谱面游戏时长超限
                shouldEndGameNow = true; endReason = "安全超时：空谱面游戏时长超限";
            }
        }

        if (shouldEndGameNow) { endGame(endReason); return; } // 结束游戏
        animationFrameId = requestAnimationFrame(gameLoop); // 请求下一帧动画
    }

    // --- 游戏逻辑 ---
    // 处理游戏输入（键盘、鼠标、触摸）
    function handleGameInput() {
        if (!isPlaying || !ctx) return; // 非游戏状态或无Canvas上下文则不处理
        // 播放打击音效
        if (audioContext && hitSoundBuffer) {
            if (audioContext.state === 'suspended') audioContext.resume().catch(e => console.warn("AudioContext输入时恢复失败:", e.message)); // 尝试恢复被挂起的AudioContext
            if (audioContext.state === 'running') {
                try {
                    const source = audioContext.createBufferSource();
                    source.buffer = hitSoundBuffer; source.connect(audioContext.destination); source.start(0);
                } catch (e) { console.error("播放打击音效出错:", e.message); }
            }
        }
        judgeFlick(); // 进行Flick判定
    }

    // 键盘按下事件处理
    function handleKeyPress(event) {
        if (!event || !isPlaying || event.repeat || typeof event.key !== 'string' ) return; // 忽略无效事件、重复按键、非游戏状态
        if (!(event.key.length === 1 && /^[a-zA-Z]$/.test(event.key))) return; // 只处理单个字母按键（示例，可根据实际需求修改）
        handleGameInput();
    }
    // 鼠标按下事件处理
    function handleMouseDown(event) { if (!event || event.button !== 0 || !isPlaying) return; handleGameInput(); } // 只处理左键
    // 触摸开始事件处理
    function handleTouchStart(event) {
        if (!event || !isPlaying) return; event.preventDefault(); // 阻止默认触摸行为（如滚动）
        if (event.changedTouches && event.changedTouches.length > 0) { // 处理所有触摸点
            for (let i = 0; i < event.changedTouches.length; i++) handleGameInput();
        }
    }

    // 检查是否有Note错过判定时间
    function checkMissedNotes() {
        if (!processedNotes || processedNotes.length === 0) return;
        for (let i = 0; i < processedNotes.length; i++) {
            const note = processedNotes[i];
            if (!note || note.isHit || note.isMissed) continue; // 跳过已判定或无效的Note
            if (currentTime > note.time + BAD_WINDOW) { // 当前时间已超过Note的Bad判定窗口
                note.isMissed = true; combo = 0; isFullComboPossible = false; // 标记为Miss，重置连击，FC失败
                updateComboDisplay(); setJudgmentText('MISS', 'miss'); // 更新UI
            }
        }
    }

    // Flick类型Note的判定逻辑
    function judgeFlick() {
        if (!processedNotes || processedNotes.length === 0) return;
        let excellentCandidate = null, badCandidate = null; // 候选的Excellent和Bad判定Note

        // 从后向前遍历Note，优先判定离判定线近的Note
        for (let i = processedNotes.length - 1; i >= 0; i--) {
            const note = processedNotes[i];
            if (!note || note.isHit || note.isMissed) continue; // 跳过已判定或无效的Note
            
            const timeDiff = note.time - currentTime; // Note触发时间与当前时间的差值
            // 优化：快速排除远超判定范围的Note
            if (timeDiff > BAD_WINDOW + 50 || timeDiff < -(BAD_WINDOW + 200)) continue; 

            const absTimeDiff = Math.abs(timeDiff); // 时间差的绝对值
            if (absTimeDiff <= EXCELLENT_WINDOW) { // 在Excellent窗口内
                if (!excellentCandidate || absTimeDiff < Math.abs(excellentCandidate.note.time - currentTime)) { // 选择时间差更小的作为候选
                    excellentCandidate = { note, type: 'EXCELLENT', timeDiff };
                }
            } else if (absTimeDiff <= BAD_WINDOW) { // 在Bad窗口内
                if (!badCandidate || absTimeDiff < Math.abs(badCandidate.note.time - currentTime)) { // 选择时间差更小的作为候选
                    badCandidate = { note, type: 'BAD', timeDiff };
                }
            }
        }

        const judged = excellentCandidate || badCandidate; // 优先选择Excellent判定
        if (judged) {
            const { note: judgedNote, type: judgmentType, timeDiff: judgedTimeDiff } = judged;
            if (judgedNote.isHit) { console.warn(`警告：尝试重复判定音符 ID '${judgedNote.id}'。`); return; } // 防止重复判定

            judgedNote.isHit = true; // 标记为已击中
            if (judgedNote.trail) judgedNote.trail.forEach(t => t.alpha = 0); // 清除尾迹
            
            const trackSpan = judgedNote.trackInfo.end - judgedNote.trackInfo.start + 1; // 计算Note覆盖的轨道数
            let flickScore = 0;

            if (judgmentType === 'EXCELLENT') {
                flickScore = FLICK_BASE_SCORE * trackSpan; // 计算分数
                setJudgmentText('EXCELLENT', 'excellent'); // 显示判定文本
                if (judgedNote.colors) { // 添加音轨反馈效果
                    const { trailBaseR, trailBaseG, trailBaseB } = judgedNote.colors;
                    for (let i = judgedNote.trackInfo.start; i <= judgedNote.trackInfo.end; i++) {
                        activeTrackFeedbacks.push({ trackIndex: i, timeHit: currentTime, duration: FEEDBACK_DURATION, r: trailBaseR, g: trailBaseG, b: trailBaseB });
                    }
                }
                combo++; // 增加连击
            } else { // BAD判定
                flickScore = Math.floor((FLICK_BASE_SCORE * trackSpan) * 0.2); // Bad分数为Excellent的20%
                setJudgmentText('BAD', 'bad');
                combo = 0; isFullComboPossible = false; // 重置连击，FC失败
            }
            score += flickScore; updateScoreDisplay(); updateComboDisplay(); // 更新分数和连击显示
        }
    }

    // 更新分数显示
    function updateScoreDisplay() { if (scoreDisplay) scoreDisplay.textContent = String(score); }
    // 更新连击显示
    function updateComboDisplay() { if (comboDisplay) comboDisplay.textContent = String(combo); }

    // 设置判定文本及其样式，并在一段时间后清除
    function setJudgmentText(text, typeClass) {
        if (judgmentTimeoutId) clearTimeout(judgmentTimeoutId); // 清除上一个判定文本的计时器
        if (!judgmentTextDisplay) return;
        judgmentTextDisplay.textContent = text;
        judgmentTextDisplay.className = (typeof typeClass === 'string' && typeClass) ? `judgment-${typeClass}` : ''; // 设置CSS类以应用不同颜色
        const container = judgmentTextDisplay.parentElement; // 父容器也可能需要更新类名（如果设计如此）
        if (container) container.className = 'info-item judgment-display';

        if (text) { // 如果有文本，则设置超时清除
            judgmentTimeoutId = setTimeout(() => {
                // 确保清除的是当前显示的文本，防止异步问题
                if (judgmentTextDisplay && judgmentTextDisplay.textContent === text) { 
                    judgmentTextDisplay.textContent = ''; judgmentTextDisplay.className = '';
                    if (container) container.className = 'info-item judgment-display';
                }
            }, JUDGMENT_TEXT_DURATION);
        }
    }

    // --- 游戏结束 ---
    function endGame(reason = "未知原因") {
        if (!isPlaying && animationFrameId === null) return; // 防止重复调用或在非游戏状态调用
        console.info(`游戏结束。原因：${reason}`);

        // 重置游戏状态
        isPlaying = false; gameShouldEndByMusic = false;
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; } // 停止游戏循环
        stopBackgroundMusic(); // 停止BGM
        if (judgmentTimeoutId) { clearTimeout(judgmentTimeoutId); judgmentTimeoutId = null; } // 清除判定文本计时器
        setJudgmentText('', ''); // 清空判定文本
        activeTrackFeedbacks = []; // 清空音轨反馈

        // 显示结算界面
        if (finalScoreDisplay) finalScoreDisplay.textContent = String(score); // 显示最终分数
        if (fullComboText && processedNotes) { // 显示Full Combo文本（如果达成）
            const allNotesHit = processedNotes.every(n => n && n.isHit); // 检查是否所有Note都被击中
            const showFC = isFullComboPossible && totalNotesInChart > 0 && allNotesHit;
            fullComboText.classList.toggle('hidden', !showFC); // 根据是否FC切换显示/隐藏
            fullComboText.classList.toggle('flicker', showFC); // FC时添加闪烁效果
            if (showFC) console.info("Full Combo!");
        }
        if (resultsOverlay) resultsOverlay.classList.remove('hidden'); // 显示结算遮罩
        
        // 恢复开始按钮和流速选择器的显示与状态
        if (startButton) {
            startButton.textContent = "PLAY AGAIN!";
            startButton.classList.remove('hidden'); 
            startButton.style.top = "80%"; // 将按钮移动到屏幕下方，方便点击
            startButton.disabled = false;
        }
        if (speedSelectorContainer) { 
            speedSelectorContainer.classList.remove('hidden');
        }
    }

    init(); // 初始化游戏
});