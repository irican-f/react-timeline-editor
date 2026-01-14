import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { AutoSizer, Grid, GridCellRenderer, OnScrollParams } from 'react-virtualized';
import { TimelineRow } from '@xzdarcy/timeline-engine';
import { CommonProp } from '../../interface/common_prop';
import { EditData } from '../../interface/timeline';
import { prefix } from '../../utils/deal_class_prefix';
import { parserTimeToPixel } from '../../utils/deal_data';
import { DragLines } from './drag_lines';
import './edit_area.less';
import { EditRow } from './edit_row';
import { useDragLine } from './hooks/use_drag_line';
import { calculateRowAccumulatedHeight, calculateTotalHeight, getRowHeights, calculateInsertionLineTop, isValidDragTarget } from './drag_utils';
import { InsertionLine } from './insertion_line';
import { DragPreview } from './drag_preview';

export type EditAreaProps = CommonProp & {
  /** 距离左侧滚动距离 */
  scrollLeft: number;
  /** 距离顶部滚动距离 */
  scrollTop: number;
  /** 滚动回调，用于同步滚动 */
  onScroll: (params: OnScrollParams) => void;
  /** 设置编辑器数据 */
  setEditorData: (params: TimelineRow[]) => void;
  /** 设置scroll left */
  deltaScrollLeft: (scrollLeft: number) => void;
};

/** edit area ref数据 */
export interface EditAreaState {
  domRef: React.MutableRefObject<HTMLDivElement | null>;
}

// 拖拽状态接口
interface DragState {
  isDragging: boolean;
  draggedRow: TimelineRow | null;
  draggedIndex: number;
  targetIndex: number;
  placeholderIndex: number;
  originalData: TimelineRow[];
  insertionLine: {
    visible: boolean;
    position: 'top' | 'bottom';
    index: number;
  };
  dragPreview: {
    visible: boolean;
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

const initialDragState: DragState = {
  isDragging: false,
  draggedRow: null,
  draggedIndex: -1,
  targetIndex: -1,
  placeholderIndex: -1,
  originalData: [],
  insertionLine: {
    visible: false,
    position: 'top',
    index: -1,
  },
  dragPreview: {
    visible: false,
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

export const EditArea = React.forwardRef<EditAreaState, EditAreaProps>((props, ref) => {
  const {
    editorData,
    rowHeight,
    scaleWidth,
    scaleCount,
    startLeft,
    scrollLeft,
    scrollTop,
    scale,
    hideCursor = false,
    cursorTime,
    onScroll,
    dragLine,
    getAssistDragLineActionIds,
    onActionMoveEnd,
    onActionMoveStart,
    onActionMoving,
    onActionResizeEnd,
    onActionResizeStart,
    onActionResizing,
    disableRowDrag,
    onRowDragStart,
    onRowDragEnd,
    setEditorData,
  } = props;
  const { dragLineData, initDragLine, updateDragLine, disposeDragLine, defaultGetAssistPosition, defaultGetMovePosition } = useDragLine();
  const editAreaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Grid>(null);
  const heightRef = useRef(-1);

  // 拖拽状态管理
  const [dragState, setDragState] = useState<DragState>(initialDragState);

  // ref 数据
  useImperativeHandle(ref, () => ({
    get domRef() {
      return editAreaRef;
    },
  }));

  // 行重新排序算法
  const reorderRows = useCallback((data: TimelineRow[], fromIndex: number, toIndex: number): TimelineRow[] => {
    const result = [...data];

    // 修正拖拽排序逻辑：考虑目标位置在源位置之后的情况
    // 注意：当拖拽到最后一行时（toIndex = data.length），不需要修正
    if (toIndex > fromIndex && toIndex < data.length) {
      toIndex = toIndex - 1;
    }

    const [removed] = result.splice(fromIndex, 1);
    result.splice(toIndex, 0, removed);
    return result;
  }, []);

  // 计算目标位置 - 基于鼠标距离最近的行边界
  const calculateTargetIndex = useCallback(
    (clientY: number): { index: number; position: 'top' | 'bottom' } => {
      if (!editAreaRef.current || !gridRef.current) return { index: -1, position: 'top' };

      const rect = editAreaRef.current.getBoundingClientRect();
      const viewportTop = clientY - rect.top + scrollTop;

      const rowCount = editorData.length;
      let currentTop = 0;

      // 如果鼠标在第一个行之前，插入到第一行上方
      if (rowCount > 0 && viewportTop < 0) {
        return { index: 0, position: 'top' };
      }

      for (let i = 0; i < rowCount; i++) {
        const rowHeight = editorData[i]?.rowHeight || props.rowHeight;
        const rowBottom = currentTop + rowHeight;

        if (viewportTop >= currentTop && viewportTop <= rowBottom) {
          const distanceToTop = Math.abs(viewportTop - currentTop);
          const distanceToBottom = Math.abs(viewportTop - rowBottom);

          if (distanceToTop < distanceToBottom) {
            return { index: i, position: 'top' };
          } else {
            return { index: i + 1, position: 'top' };
          }
        }

        currentTop = rowBottom;
      }

      return { index: rowCount, position: 'top' };
    },
    [editorData, props.rowHeight, scrollTop],
  );

  // 计算拖拽预览位置
  const calculateDragPreviewPosition = useCallback(
    (clientY: number, dragPreviewHeight: number) => {
      if (!editAreaRef.current) return 0;

      const rect = editAreaRef.current.getBoundingClientRect();
      // 计算鼠标在编辑区域内的相对Y坐标，加上当前滚动位置
      let previewTop = clientY - rect.top + scrollTop;
      // 调整为元素中心对齐鼠标
      previewTop -= dragPreviewHeight / 2;

      // 限制预览元素在编辑区域内
      const editAreaHeight = rect.height;
      previewTop = Math.max(0, Math.min(previewTop, editAreaHeight - dragPreviewHeight));
      return previewTop;
    },
    [scrollTop],
  );

  // 初始化拖拽状态
  const initializeDragState = useCallback(
    (row: TimelineRow, rowIndex: number) => {
      const originalData = [...editorData];
      const dragPreviewHeight = row.rowHeight || props.rowHeight;

      // 使用工具函数计算拖拽预览位置
      const dragPreviewTop = calculateRowAccumulatedHeight(editorData, rowIndex, props.rowHeight);

      return {
        isDragging: true,
        draggedRow: row,
        draggedIndex: rowIndex,
        targetIndex: -1,
        placeholderIndex: rowIndex,
        originalData,
        insertionLine: {
          visible: false,
          position: 'top' as const,
          index: -1,
        },
        dragPreview: {
          visible: true,
          top: dragPreviewTop,
          left: 0,
          width: 0,
          height: dragPreviewHeight,
        },
      };
    },
    [editorData, props.rowHeight, calculateRowAccumulatedHeight],
  );

  // 更新拖拽状态
  const updateDragState = useCallback((currentState: DragState, targetIndex: number, previewTop: number, rowIndex: number) => {
    if (currentState.targetIndex === targetIndex && currentState.dragPreview.top === previewTop) {
      return currentState; // 状态未变化，避免不必要的重渲染
    }

    return {
      ...currentState,
      targetIndex,
      placeholderIndex: targetIndex > rowIndex ? targetIndex - 1 : targetIndex,
      insertionLine: {
        visible: targetIndex !== -1 && targetIndex !== rowIndex,
        position: 'top' as const,
        index: targetIndex,
      },
      dragPreview: {
        ...currentState.dragPreview,
        top: previewTop,
      },
    };
  }, []);

  // 处理拖拽结束
  const handleDragEnd = useCallback(
    (draggedIndex: number, targetIndex: number, draggedRow: TimelineRow | null, originalData: TimelineRow[]) => {
      if (isValidDragTarget(targetIndex, draggedIndex, editorData.length)) {
        const newData = reorderRows(editorData, draggedIndex, targetIndex);
        setEditorData(newData);
        onRowDragEnd?.({ row: draggedRow!, editorData: newData });
      } else {
        setEditorData(originalData);
      }
    },
    [editorData, reorderRows, setEditorData, onRowDragEnd, isValidDragTarget],
  );

  // 处理行拖拽开始
  const handleRowDragStart = useCallback(
    (row: TimelineRow, rowIndex: number) => {
      if (disableRowDrag) return;

      // 初始化拖拽状态
      const initialDragState = initializeDragState(row, rowIndex);
      setDragState(initialDragState);

      // 触发回调
      onRowDragStart?.({ row });

      // 防抖机制控制变量
      let animationFrameId: number | null = null;
      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 16; // 约60fps，与浏览器刷新率匹配

      // 鼠标移动处理函数
        const handleMouseMove = (moveEvent: MouseEvent) => {
          const currentTime = Date.now();

          // 取消之前的动画帧
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
          }

          // 使用requestAnimationFrame确保与浏览器渲染同步
          animationFrameId = requestAnimationFrame(() => {
            // 检查时间间隔，控制更新频率
            if (currentTime - lastUpdateTime >= UPDATE_INTERVAL) {
              const targetInfo = calculateTargetIndex(moveEvent.clientY);
              const targetIndex = targetInfo.index;
              const previewTop = calculateDragPreviewPosition(moveEvent.clientY, initialDragState.dragPreview.height);

              // 直接更新状态，避免setTimeout延迟
              setDragState((prev) => updateDragState(prev, targetIndex, previewTop, rowIndex));
              lastUpdateTime = currentTime;
            }
            animationFrameId = null;
          });
        };

      // 鼠标抬起处理函数
      const handleMouseUp = () => {
        // 清理动画帧
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }

        // 使用函数式更新确保获取最新状态
        setDragState((prevState) => {
          const { draggedIndex, targetIndex, originalData, draggedRow } = prevState;

          // 立即重置拖拽状态，确保视觉反馈立即消失
          const resetState = {
            ...initialDragState,
            draggedIndex: -1,
            dragPreview: {
              ...initialDragState.dragPreview,
              visible: false,
            },
            insertionLine: {
              ...initialDragState.insertionLine,
              visible: false,
            },
          };

          // 然后处理拖拽结束逻辑
          setTimeout(() => {
            handleDragEnd(draggedIndex, targetIndex, draggedRow, originalData);
          }, 0);

          return resetState;
        });

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [disableRowDrag, onRowDragStart, initializeDragState, calculateTargetIndex, calculateDragPreviewPosition, updateDragState, handleDragEnd],
  );

  const handleInitDragLine: EditData['onActionMoveStart'] = (data) => {
    if (dragLine) {
      const assistActionIds =
        getAssistDragLineActionIds &&
        getAssistDragLineActionIds({
          action: data.action,
          row: data.row,
          editorData,
        });
      const cursorLeft = parserTimeToPixel(cursorTime, { scaleWidth, scale, startLeft });
      const assistPositions = defaultGetAssistPosition({
        editorData,
        assistActionIds,
        action: data.action,
        row: data.row,
        scale,
        scaleWidth,
        startLeft,
        hideCursor,
        cursorLeft,
      });
      initDragLine({ assistPositions });
    }
  };

  const handleUpdateDragLine: EditData['onActionMoving'] = (data) => {
    if (dragLine) {
      const movePositions = defaultGetMovePosition({
        ...data,
        startLeft,
        scaleWidth,
        scale,
      });
      updateDragLine({ movePositions });
    }
  };

  /** 获取每个cell渲染内容 */
  const cellRenderer: GridCellRenderer = ({ rowIndex, key, style }) => {
    const row = editorData[rowIndex];

    return (
      <EditRow
        {...props}
        style={{
          ...style,
          backgroundPositionX: `0, ${startLeft}px`,
          backgroundSize: `${startLeft}px, ${scaleWidth}px`,
        }}
        areaRef={editAreaRef}
        key={key}
        rowHeight={row?.rowHeight || rowHeight}
        rowData={row}
        dragLineData={dragLineData}
        rowIndex={rowIndex}
        dragState={{
          isDragging: dragState.draggedIndex !== -1,
          draggedIndex: dragState.draggedIndex,
        }}
        onRowDragStart={(params) => {
          handleRowDragStart(params.row, rowIndex);
        }}
        onActionMoveStart={(data) => {
          handleInitDragLine(data);
          return onActionMoveStart && onActionMoveStart(data);
        }}
        onActionResizeStart={(data) => {
          handleInitDragLine(data);
          return onActionResizeStart && onActionResizeStart(data);
        }}
        onActionMoving={(data) => {
          handleUpdateDragLine(data);
          return onActionMoving && onActionMoving(data);
        }}
        onActionResizing={(data) => {
          handleUpdateDragLine(data);
          return onActionResizing && onActionResizing(data);
        }}
        onActionResizeEnd={(data) => {
          disposeDragLine();
          return onActionResizeEnd && onActionResizeEnd(data);
        }}
        onActionMoveEnd={(data) => {
          disposeDragLine();
          return onActionMoveEnd && onActionMoveEnd(data);
        }}
      />
    );
  };

  useLayoutEffect(() => {
    gridRef.current?.scrollToPosition({ scrollTop, scrollLeft });
  }, [scrollTop, scrollLeft]);

  useEffect(() => {
    gridRef.current?.recomputeGridSize();
  }, [editorData]);

  return (
    <div ref={editAreaRef} className={prefix('edit-area')}>
      <AutoSizer>
        {({ width, height }) => {
          // 获取全部高度
          const totalHeight = calculateTotalHeight(editorData, rowHeight);
          // 高度列表
          const heights = getRowHeights(editorData, rowHeight);
          if (totalHeight < height) {
            heights.push(height - totalHeight);
            if (heightRef.current !== height && heightRef.current >= 0) {
              setTimeout(() =>
                gridRef.current?.recomputeGridSize({
                  rowIndex: heights.length - 1,
                }),
              );
            }
          }
          heightRef.current = height;

          return (
            <>
              <Grid
                columnCount={1}
                rowCount={heights.length}
                ref={gridRef}
                cellRenderer={cellRenderer}
                columnWidth={Math.max(scaleCount * scaleWidth + startLeft, width)}
                width={width}
                height={height}
                rowHeight={({ index }) => heights[index] || rowHeight}
                overscanRowCount={10}
                overscanColumnCount={0}
                onScroll={(param) => {
                  onScroll(param);
                }}
              />
              {/* 插入线指示器 */}
              <InsertionLine editorData={editorData} rowHeight={rowHeight} insertionLineIndex={dragState.insertionLine.index} visible={dragState.insertionLine.visible} />
              {/* 拖拽预览元素 */}
              <DragPreview top={dragState.dragPreview.top} height={dragState.dragPreview.height} visible={dragState.dragPreview.visible} />
            </>
          );
        }}
      </AutoSizer>
      {dragLine && <DragLines scrollLeft={scrollLeft} {...dragLineData} />}
    </div>
  );
});
