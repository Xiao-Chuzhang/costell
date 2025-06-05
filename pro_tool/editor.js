// editor.js
window.onload = () => {
    // --- DOM 元素引用 ---
    const bandoriJsonInput = document.getElementById('bandoriJsonInput');
    const parseButton = document.getElementById('parseButton');
    const costellJsonOutput = document.getElementById('costellJsonOutput');
    const exportButton = document.getElementById('exportButton');
    const statusMessage = document.getElementById('statusMessage');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const canvas = document.getElementById('chartCanvas');
    const ctx = canvas.getContext('2d');

    // --- 全局状态管理 ---
    let costellChart = { bpm: 0, notes: [] }; // 当前 Costell 谱面数据
    let selectedNoteObject = null;             // 当前选中的音符对象
    let noteIdCounter = 0;                     // 音符唯一ID计数器

    // --- Canvas 绘图配置 ---
    const NUM_COSTELL_TRACKS = 15;     // Costell 3 轨道总数
    const MIN_COSTELL_TRACK_NUM = 1;   // Costell 3 最小轨道编号
    const MAX_COSTELL_TRACK_NUM = NUM_COSTELL_TRACKS; // Costell 3 最大轨道编号
    const TRACK_WIDTH = 45;            // 每条轨道的像素宽度
    const BEAT_PIXEL_SCALE = 55;       // 每拍在 Canvas 上的像素高度
    const NOTE_HEIGHT = 22;            // 音符的像素高度
    const CANVAS_PADDING_X = 30;       // Canvas 水平边距
    const CANVAS_PADDING_Y = 40;       // Canvas 垂直边距
    const STRETCH_HANDLE_WIDTH = 12;   // 音符拉伸手柄的宽度

    // --- 拖拽交互状态 ---
    let isDragging = false;              // 是否正在拖拽
    let dragMode = null;                 // 拖拽模式: 'move' (移动), 'stretch-left' (左侧拉伸), 'stretch-right' (右侧拉伸)
    let dragStartX, dragStartY;          // 拖拽起始时的鼠标坐标
    let originalNoteDataForDrag = null;  // 拖拽开始时选中音符的原始数据副本，用于计算偏移

    /**
     * 应用初始化。
     * 绑定事件监听器，设置 Canvas 初始状态。
     */
    function init() {
        parseButton.addEventListener('click', handleParse);
        exportButton.addEventListener('click', handleExport);
        canvas.addEventListener('mousedown', onCanvasMouseDown);
        canvas.addEventListener('mousemove', onCanvasMouseMove);
        canvas.addEventListener('mouseup', onCanvasMouseUp);
        canvasWrapper.addEventListener('mouseleave', onCanvasMouseLeave); // 防止拖拽状态在鼠标离开 Canvas 后卡住
        document.addEventListener('keydown', onKeyDown); // 监听按键事件（如删除音符）

        exportButton.disabled = true;
        canvas.width = CANVAS_PADDING_X * 2 + NUM_COSTELL_TRACKS * TRACK_WIDTH;
        clearCanvasAndMessage("请先加载并解析 Bandori 谱面数据");
    }

    /**
     * 清空 Canvas 并显示一条消息。
     * @param {string} message 要显示的消息。
     */
    function clearCanvasAndMessage(message) {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // 清空 Canvas
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height); // 填充白色背景
        ctx.fillStyle = "#6c757d";
        ctx.font = "18px 'Roboto', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(message, canvas.width / 2, 80);
        // 根据父容器高度调整 Canvas 高度，确保至少有最小高度
        canvas.height = Math.max(200, canvasWrapper.clientHeight > 0 ? canvasWrapper.clientHeight - 2 : 400);
    }

    /**
     * 更新状态消息显示。
     * @param {string} message 要显示的消息。
     * @param {boolean} [isError=false] 是否为错误消息。
     */
    function setStatus(message, isError = false) {
        statusMessage.textContent = message;
        statusMessage.classList.remove('status-success', 'status-error');
        if (message) {
            statusMessage.classList.add(isError ? 'status-error' : 'status-success');
        }
        if (isError) {
            console.error("谱面编辑器状态:", message);
        }
    }

    /**
     * 辅助函数：将 Bandori 音符节点（Single 或 Slide connection）转换为 Costell 3 音符并添加到谱面。
     * 处理轨道映射、flick 音符宽度转换和轨道边界适应。
     * @param {number} beat 音符的节拍位置。
     * @param {number} lane Bandori 音符的轨道编号 (0-6)。
     * @param {boolean} [flick=false] 是否为 flick 音符。
     */
    function addCostellNoteFromBandoriNode(beat, lane, flick = false) {
        // Bandori lane (0-6) 映射到 Costell 3 的偶数轨道 (2, 4, 6, ..., 14)
        // Bandori lane 0 -> Costell track 2
        // Bandori lane 1 -> Costell track 4
        // ...
        // Bandori lane 6 -> Costell track 14
        const costellTrackBaseOneIndexed = lane * 2 + 2;

        if (flick === true) {
            let startTrack = costellTrackBaseOneIndexed;
            let endTrack = costellTrackBaseOneIndexed + 1; // Flick 音符期望长度为2

            let adjusted = false; // 标记是否发生了轨道调整

            // 适应轨道边界：如果超出最大轨道，则向左整体移动
            if (endTrack > MAX_COSTELL_TRACK_NUM && NUM_COSTELL_TRACKS >= 2) {
                endTrack = MAX_COSTELL_TRACK_NUM;
                startTrack = MAX_COSTELL_TRACK_NUM - 1; // 确保长度为2
                adjusted = true;
            }
            // 适应轨道边界：如果起始轨道小于最小轨道，则向右整体移动
            else if (startTrack < MIN_COSTELL_TRACK_NUM && NUM_COSTELL_TRACKS >= 2) {
                startTrack = MIN_COSTELL_TRACK_NUM;
                endTrack = MIN_COSTELL_TRACK_NUM + 1; // 确保长度为2
                adjusted = true;
            }

            // 最终限制轨道在有效范围内
            startTrack = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, startTrack));
            endTrack = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, endTrack));

            // 如果成功形成长度为2的区间音符
            if (endTrack > startTrack && (endTrack - startTrack + 1) === 2) {
                costellChart.notes.push({
                    id: noteIdCounter++,
                    beat: beat,
                    track: [startTrack, endTrack] // 存储区间轨道
                });
                if (adjusted) {
                    console.warn(`Bandori Flick-like note (beat: ${beat}, lane: ${lane}) adjusted to [${startTrack}, ${endTrack}] due to Costell track limits.`);
                    setStatus(`警告: 部分 Flick 音符轨道超出 Costell 范围，已调整。详情请查看控制台。`, true);
                }
            } else {
                // 无法形成长度为2的有效区间，退化为单轨音符
                const finalSingleTrack = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, costellTrackBaseOneIndexed));
                costellChart.notes.push({
                    id: noteIdCounter++,
                    beat: beat,
                    track: finalSingleTrack
                });
                console.warn(`Bandori Flick-like note (beat: ${beat}, lane: ${lane}) failed to form 2-track interval, converted to single track ${finalSingleTrack}.`);
                setStatus(`警告: 部分 Flick 音符无法形成区间，已转换为单轨。详情请查看控制台。`, true);
            }

        } else { // 处理普通的（非 Flick）单轨音符
            if (costellTrackBaseOneIndexed >= MIN_COSTELL_TRACK_NUM && costellTrackBaseOneIndexed <= MAX_COSTELL_TRACK_NUM) {
                costellChart.notes.push({
                    id: noteIdCounter++,
                    beat: beat,
                    track: costellTrackBaseOneIndexed // 存储1-15的轨道号
                });
            } else {
                console.warn(`Bandori note (beat: ${beat}, lane: ${lane}) converted to ${costellTrackBaseOneIndexed}, out of Costell track range. This note has been ignored.`);
                setStatus(`警告: 部分 Bandori 音符轨道超出 Costell 范围，已被忽略。详情请查看控制台。`, true);
            }
        }
    }

    /**
     * 处理解析 Bandori JSON 数据的点击事件。
     * 验证输入，执行转换，并更新 UI。
     */
    function handleParse() {
        const jsonString = bandoriJsonInput.value;
        if (!jsonString.trim()) {
            setStatus("请输入 Bandori JSON 数据。", true);
            return;
        }
        try {
            const bandoriData = JSON.parse(jsonString);
            if (!Array.isArray(bandoriData)) {
                setStatus("无效的 Bandori JSON 格式：顶层结构应为数组。", true);
                return;
            }
            convertToCostellFormat(bandoriData);
            setStatus("谱面解析加载成功！", false);
            exportButton.disabled = false;
            selectedNoteObject = null; // 清除选中状态
            renderChart();
        } catch (error) {
            console.error("解析 Bandori JSON 失败:", error);
            setStatus(`解析 Bandori JSON 失败: ${error.message}`, true);
            costellChart = { bpm: 0, notes: [] }; // 清空数据
            exportButton.disabled = true;
            selectedNoteObject = null;
            clearCanvasAndMessage("谱面加载失败，请检查输入数据。");
        }
    }

    /**
     * 将 Bandori 谱面数据转换为 Costell 3 格式。
     * @param {Array<Object>} bandoriData Bandori 谱面原始数据数组。
     */
    function convertToCostellFormat(bandoriData) {
        costellChart = { bpm: 0, notes: [] };
        noteIdCounter = 0;

        // 提取 BPM 信息
        const bpmObject = bandoriData.find(item => item.type === "BPM");
        if (bpmObject && typeof bpmObject.bpm === 'number') {
            costellChart.bpm = bpmObject.bpm;
        } else {
            setStatus("警告: Bandori数据中未找到有效的BPM信息，将使用默认BPM 0。", true);
        }

        bandoriData.forEach(item => {
            if (typeof item.type !== 'string') {
                console.warn(`发现无效的谱面项：'type'属性缺失或类型不正确。`, item);
                setStatus(`警告: 发现无效的谱面项，已跳过。详情请查看控制台。`, true);
                return;
            }

            if (item.type === "Single") {
                if (typeof item.lane === 'number' && typeof item.beat === 'number') {
                    addCostellNoteFromBandoriNode(item.beat, item.lane, item.flick === true);
                } else {
                    console.warn(`无效的 Bandori Single 音符格式: 缺少 'beat' 或 'lane' 参数，或类型不正确。`, item);
                    setStatus(`警告: 发现格式错误的 Bandori Single 音符，已跳过。详情请查看控制台。`, true);
                }
            } else if (item.type === "Slide") {
                if (Array.isArray(item.connections) && item.connections.length > 0) {
                    item.connections.forEach((connection, index) => {
                        // 检查每个连接节点的数据有效性
                        if (typeof connection.beat === 'number' && typeof connection.lane === 'number') {
                            addCostellNoteFromBandoriNode(connection.beat, connection.lane, connection.flick === true);
                        } else {
                            console.warn(`无效的 Bandori Slide 节点格式 (index: ${index}): 缺少 'beat' 或 'lane' 参数，或类型不正确。`, connection);
                            setStatus(`警告: 发现格式错误的 Bandori Slide 节点 (index: ${index})，已跳过。详情请查看控制台。`, true);
                        }
                    });
                } else {
                    console.warn("无效的 Bandori Slide 格式: 'connections' 属性缺失、不是数组或为空。", item);
                    setStatus("警告: 发现格式错误的 Bandori Slide 音符（'connections'缺失或为空），已跳过。详情请查看控制台。", true);
                }
            }
            // 其他未识别的 type 将被忽略
        });
        // 转换完成后对音符进行排序，以确保渲染和导出的一致性
        costellChart.notes.sort((a, b) => a.beat - b.beat || getTrackStart(a.track) - getTrackStart(b.track));
    }

    /**
     * 获取音符轨道的起始编号 (1-15)。
     * 处理单轨音符（数字）和区间音符（数组）两种情况。
     * @param {number|number[]} trackData 音符的轨道数据。
     * @returns {number} 起始轨道编号。
     */
    function getTrackStart(trackData) {
        return Array.isArray(trackData) ? Math.min(trackData[0], trackData[1]) : trackData;
    }

    /**
     * 获取音符轨道的结束编号 (1-15)。
     * 处理单轨音符（数字）和区间音符（数组）两种情况。
     * @param {number|number[]} trackData 音符的轨道数据。
     * @returns {number} 结束轨道编号。
     */
    function getTrackEnd(trackData) {
        return Array.isArray(trackData) ? Math.max(trackData[0], trackData[1]) : trackData;
    }

    /**
     * 渲染 Costell 3 谱面到 Canvas。
     * 绘制轨道、节拍线和所有音符。
     */
    function renderChart() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!costellChart || (costellChart.notes.length === 0 && costellChart.bpm === 0)) {
            clearCanvasAndMessage(costellChart.bpm === 0 && costellChart.notes.length === 0 ? "请加载谱面数据" : "当前谱面为空");
            return;
        }

        // 动态调整 Canvas 宽度以适应轨道数量
        canvas.width = CANVAS_PADDING_X * 2 + NUM_COSTELL_TRACKS * TRACK_WIDTH;
        let maxBeat = 0; // 找到最大节拍数以确定 Canvas 高度
        costellChart.notes.forEach(note => {
            if (note.beat > maxBeat) maxBeat = note.beat;
        });

        // 根据内容高度和父容器高度调整 Canvas 高度
        const minContentHeight = CANVAS_PADDING_Y * 2 + (maxBeat + 2) * BEAT_PIXEL_SCALE;
        const wrapperVisibleHeight = canvasWrapper.clientHeight > 2 ? canvasWrapper.clientHeight - 2 : 500;
        canvas.height = Math.max(minContentHeight, wrapperVisibleHeight);

        // 绘制轨道分隔线和轨道编号
        ctx.strokeStyle = "#ced4da";
        ctx.lineWidth = 1;
        for (let i = 0; i < NUM_COSTELL_TRACKS; i++) {
            const xTrackStart = CANVAS_PADDING_X + i * TRACK_WIDTH;
            ctx.fillStyle = "#495057";
            ctx.font = "11px 'Roboto', 'Segoe UI', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText((i + 1).toString(), xTrackStart + TRACK_WIDTH / 2, CANVAS_PADDING_Y - 18);
        }
        for (let i = 0; i <= NUM_COSTELL_TRACKS; i++) {
            const xLine = CANVAS_PADDING_X + i * TRACK_WIDTH;
            ctx.beginPath();
            ctx.moveTo(xLine, 0);
            ctx.lineTo(xLine, canvas.height);
            ctx.stroke();
        }

        // 绘制节拍线和节拍编号
        for (let b = 0; b <= maxBeat + 1.5; b += 0.25) {
            const y = CANVAS_PADDING_Y + b * BEAT_PIXEL_SCALE;
            ctx.beginPath();
            ctx.moveTo(CANVAS_PADDING_X, y);
            ctx.lineTo(canvas.width - CANVAS_PADDING_X, y);
            if (b % 1 === 0) { ctx.lineWidth = 1; ctx.strokeStyle = "#adb5bd"; } // 整拍线
            else if (b % 0.5 === 0) { ctx.lineWidth = 0.75; ctx.strokeStyle = "#ced4da"; } // 半拍线
            else { ctx.lineWidth = 0.5; ctx.strokeStyle = "#e9ecef"; } // 四分之一拍线
            ctx.stroke();
            if (b % 1 === 0) {
                ctx.fillStyle = "#495057";
                ctx.font = "10px 'Roboto', 'Segoe UI', sans-serif";
                ctx.textAlign = "right";
                ctx.fillText(b.toString(), CANVAS_PADDING_X - 12, y + 4);
            }
        }

        // 绘制所有音符
        costellChart.notes.forEach(note => {
            const startTrackOneIndexed = getTrackStart(note.track);
            const endTrackOneIndexed = getTrackEnd(note.track);

            const x = CANVAS_PADDING_X + (startTrackOneIndexed - 1) * TRACK_WIDTH;
            const yNote = CANVAS_PADDING_Y + note.beat * BEAT_PIXEL_SCALE - NOTE_HEIGHT / 2;
            const noteW = (endTrackOneIndexed - startTrackOneIndexed + 1) * TRACK_WIDTH;

            const isSelected = (note === selectedNoteObject);
            ctx.fillStyle = isSelected ? '#007bff' : '#28a745'; // 选中蓝色，未选中绿色
            ctx.strokeStyle = isSelected ? '#0056b3' : '#1e7e34';
            ctx.lineWidth = isSelected ? 2.5 : 1.5;

            ctx.beginPath();
            ctx.rect(x, yNote, noteW, NOTE_HEIGHT);
            ctx.fill();
            ctx.stroke();

            // 选中音符时绘制拉伸手柄
            if (isSelected) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
                const handleVisualWidth = STRETCH_HANDLE_WIDTH / 1.5;
                ctx.fillRect(x, yNote, handleVisualWidth, NOTE_HEIGHT);
                ctx.fillRect(x + noteW - handleVisualWidth, yNote, handleVisualWidth, NOTE_HEIGHT);
            }
        });
    }

    /**
     * 获取鼠标在 Canvas 上的相对坐标。
     * @param {HTMLElement} canvasElement Canvas DOM 元素。
     * @param {MouseEvent} domEvent 鼠标事件对象。
     * @returns {{x: number, y: number}} 鼠标相对 Canvas 的坐标。
     */
    function getMousePos(canvasElement, domEvent) {
        const rect = canvasElement.getBoundingClientRect();
        return {
            x: domEvent.clientX - rect.left,
            y: domEvent.clientY - rect.top
        };
    }

    /**
     * 判断鼠标位置是否命中某个音符及其拖拽区域。
     * @param {number} mouseX 鼠标 X 坐标。
     * @param {number} mouseY 鼠标 Y 坐标。
     * @returns {{noteObject: Object, region: string}|null} 命中结果，包含音符对象和命中区域。
     */
    function getNoteAndDragRegion(mouseX, mouseY) {
        // 从后往前遍历，优先命中绘制在顶部的音符
        for (let i = costellChart.notes.length - 1; i >= 0; i--) {
            const note = costellChart.notes[i];
            const startTrackOneIndexed = getTrackStart(note.track);
            const endTrackOneIndexed = getTrackEnd(note.track);

            const noteCanvasXStart = CANVAS_PADDING_X + (startTrackOneIndexed - 1) * TRACK_WIDTH;
            const noteY = CANVAS_PADDING_Y + note.beat * BEAT_PIXEL_SCALE - NOTE_HEIGHT / 2;
            const noteW = (endTrackOneIndexed - startTrackOneIndexed + 1) * TRACK_WIDTH;
            const noteCanvasXEnd = noteCanvasXStart + noteW;

            if (mouseX >= noteCanvasXStart && mouseX <= noteCanvasXEnd &&
                mouseY >= noteY && mouseY <= noteY + NOTE_HEIGHT) {
                let region = 'move';
                if (mouseX < noteCanvasXStart + STRETCH_HANDLE_WIDTH) {
                     region = 'stretch-left';
                } else if (mouseX > noteCanvasXEnd - STRETCH_HANDLE_WIDTH) {
                     region = 'stretch-right';
                }
                return { noteObject: note, region: region };
            }
        }
        return null; // 未命中任何音符
    }

    /**
     * 处理 Canvas 鼠标按下事件。
     * 判断是否选中音符，并初始化拖拽状态。
     * @param {MouseEvent} event 鼠标事件对象。
     */
    function onCanvasMouseDown(event) {
        const mousePos = getMousePos(canvas, event);
        const hitResult = getNoteAndDragRegion(mousePos.x, mousePos.y);

        if (hitResult) {
            selectedNoteObject = hitResult.noteObject;
            isDragging = true;
            dragMode = hitResult.region;
            dragStartX = mousePos.x;
            dragStartY = mousePos.y;
            // 复制音符原始数据，用于拖拽时的相对位置计算
            originalNoteDataForDrag = JSON.parse(JSON.stringify(selectedNoteObject));
            canvas.style.cursor = (dragMode === 'move') ? 'grabbing' : 'ew-resize';
        } else {
            selectedNoteObject = null; // 取消选中
            isDragging = false;
            dragMode = null;
        }
        renderChart(); // 重新渲染以更新选中状态
    }

    /**
     * 处理 Canvas 鼠标移动事件。
     * 在拖拽状态下根据鼠标移动更新音符位置或宽度。
     * @param {MouseEvent} event 鼠标事件对象。
     */
    function onCanvasMouseMove(event) {
        const mousePos = getMousePos(canvas, event);

        if (isDragging && selectedNoteObject) {
            event.preventDefault(); // 阻止默认的文本选择等行为
            const noteToUpdate = selectedNoteObject;

            // 计算鼠标当前所在的 Costell 1-indexed 轨道号，并限制在有效范围内
            let currentMouseTrackZeroIndexed = Math.round((mousePos.x - CANVAS_PADDING_X - TRACK_WIDTH / 2) / TRACK_WIDTH);
            let currentMouseTrackOneIndexed = currentMouseTrackZeroIndexed + 1;
            currentMouseTrackOneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, currentMouseTrackOneIndexed));
            
            if (dragMode === 'move') {
                const originalStartOneIndexed = getTrackStart(originalNoteDataForDrag.track);
                // 计算点击点相对于音符左边缘的轨道偏移量（以0-indexed轨道单位）
                const clickOffsetFromNoteStartInZeroIndexedTracks = 
                    Math.round((dragStartX - (CANVAS_PADDING_X + (originalStartOneIndexed - 1) * TRACK_WIDTH)) / TRACK_WIDTH);

                // 根据鼠标新位置和偏移量计算音符新的起始轨道 (1-indexed)
                let newStartTrackOneIndexed = currentMouseTrackOneIndexed - clickOffsetFromNoteStartInZeroIndexedTracks;

                if (Array.isArray(originalNoteDataForDrag.track)) { // 宽音符的移动
                    const originalWidthInTracks = getTrackEnd(originalNoteDataForDrag.track) - originalStartOneIndexed;
                    let newEndTrackOneIndexed = newStartTrackOneIndexed + originalWidthInTracks;

                    // 边界检查与修正
                    if (newStartTrackOneIndexed < MIN_COSTELL_TRACK_NUM) {
                        newStartTrackOneIndexed = MIN_COSTELL_TRACK_NUM;
                        newEndTrackOneIndexed = Math.min(MAX_COSTELL_TRACK_NUM, newStartTrackOneIndexed + originalWidthInTracks);
                    }
                    if (newEndTrackOneIndexed > MAX_COSTELL_TRACK_NUM) {
                        newEndTrackOneIndexed = MAX_COSTELL_TRACK_NUM;
                        newStartTrackOneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, newEndTrackOneIndexed - originalWidthInTracks);
                    }
                    // 确保起始轨道不小于最小值
                    newStartTrackOneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, newStartTrackOneIndexed);

                    noteToUpdate.track = [Math.min(newStartTrackOneIndexed, newEndTrackOneIndexed), Math.max(newStartTrackOneIndexed, newEndTrackOneIndexed)];
                } else { // 单轨音符的移动
                    newStartTrackOneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, newStartTrackOneIndexed));
                    noteToUpdate.track = newStartTrackOneIndexed;
                }
            } 
            else if (dragMode === 'stretch-left' || dragMode === 'stretch-right') { // 宽音符的拉伸
                let t1_oneIndexed, t2_oneIndexed;
                const currentOriginalTrack = originalNoteDataForDrag.track;

                if (Array.isArray(currentOriginalTrack)) {
                    t1_oneIndexed = currentOriginalTrack[0]; 
                    t2_oneIndexed = currentOriginalTrack[1];
                } else { // 如果原始是单轨，则视为拉伸为宽音符，起始和结束轨道相同
                    t1_oneIndexed = currentOriginalTrack; 
                    t2_oneIndexed = currentOriginalTrack;
                }

                if (dragMode === 'stretch-left') {
                    t1_oneIndexed = currentMouseTrackOneIndexed;
                } else {
                    t2_oneIndexed = currentMouseTrackOneIndexed;
                }
                
                // 限制在有效轨道范围内
                t1_oneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, t1_oneIndexed));
                t2_oneIndexed = Math.max(MIN_COSTELL_TRACK_NUM, Math.min(MAX_COSTELL_TRACK_NUM, t2_oneIndexed));

                if (t1_oneIndexed === t2_oneIndexed) { // 如果拉伸到单轨
                    noteToUpdate.track = t1_oneIndexed;
                } else { // 如果拉伸为宽音符
                    noteToUpdate.track = [Math.min(t1_oneIndexed, t2_oneIndexed), Math.max(t1_oneIndexed, t2_oneIndexed)];
                }
            }
            renderChart(); // 实时更新显示
        } else {
            // 非拖拽状态下，根据鼠标位置更新鼠标样式
            const hitResult = getNoteAndDragRegion(mousePos.x, mousePos.y);
            if (hitResult) {
                canvas.style.cursor = (hitResult.region === 'move') ? 'grab' : 'ew-resize';
            } else {
                canvas.style.cursor = 'default';
            }
        }
    }

    /**
     * 处理 Canvas 鼠标松开事件。
     * 结束拖拽状态，并重新排序音符。
     * @param {MouseEvent} event 鼠标事件对象。
     */
    function onCanvasMouseUp(event) {
        if (isDragging) {
            // 拖拽结束后，重新排序音符，保持数据一致性
            costellChart.notes.sort((a, b) => a.beat - b.beat || getTrackStart(a.track) - getTrackStart(b.track));
            renderChart(); // 重新渲染以确保最终状态正确
            
            // 根据鼠标最终位置重新设置光标样式
            const mousePos = getMousePos(canvas, event);
            const hitResult = getNoteAndDragRegion(mousePos.x, mousePos.y);
            if (hitResult && hitResult.noteObject === selectedNoteObject) {
                 canvas.style.cursor = (hitResult.region === 'move') ? 'grab' : 'ew-resize';
            } else if (!hitResult) {
                canvas.style.cursor = 'default';
            }
        }
        isDragging = false; // 重置拖拽状态
    }
    
    /**
     * 处理 Canvas 鼠标离开事件。
     * 如果正在拖拽，则强制结束拖拽，防止状态卡住。
     * @param {MouseEvent} event 鼠标事件对象。
     */
    function onCanvasMouseLeave(event) { 
        if (isDragging) {
            onCanvasMouseUp(event); // 模拟鼠标松开，结束拖拽
        }
        canvas.style.cursor = 'default'; // 恢复默认光标样式
    }

    /**
     * 处理键盘按下事件。
     * 允许通过 Delete/Backspace 键删除选中的音符。
     * @param {KeyboardEvent} event 键盘事件对象。
     */
    function onKeyDown(event) {
        if (selectedNoteObject && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault(); // 阻止浏览器默认行为（如返回上一页）
            costellChart.notes = costellChart.notes.filter(note => note !== selectedNoteObject);
            selectedNoteObject = null; // 清除选中状态
            setStatus("音符已删除。", false);
            renderChart(); // 重新渲染谱面
        }
    }

    /**
     * 处理导出 Costell 3 JSON 数据的点击事件。
     * 格式化谱面数据并显示。
     */
    function handleExport() {
        if (!costellChart.bpm && costellChart.notes.length === 0) {
            setStatus("没有可导出的数据。", true);
            costellJsonOutput.value = "";
            return;
        }

        const exportData = {
            bpm: costellChart.bpm,
            notes: costellChart.notes.map(note => ({
                // 浮点数 beat 保留四位小数，避免精度问题在 JSON 中产生过长的数字
                beat: parseFloat(note.beat.toFixed(4)),
                track: note.track // 直接使用存储的1-15的轨道号 (数字或数组)
            }))
        };
        
        // 导出前再次排序，确保 JSON 顺序一致
        exportData.notes.sort((a, b) => {
            if (a.beat !== b.beat) { return a.beat - b.beat; }
            const trackA = Array.isArray(a.track) ? a.track[0] : a.track;
            const trackB = Array.isArray(b.track) ? b.track[0] : b.track;
            return trackA - trackB;
        });

        costellJsonOutput.value = JSON.stringify(exportData); // 压缩风格 JSON 输出
        setStatus("Costell 3 JSON 导出成功！", false);
        costellJsonOutput.select(); // 选中输出文本，方便用户复制
    }

    // --- 启动应用 ---
    init();
};