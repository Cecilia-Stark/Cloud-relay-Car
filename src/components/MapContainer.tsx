import React, { useEffect, useRef, useState } from 'react';
import { Compass, Layers, Locate, MapPinned, Navigation } from 'lucide-react';

interface MapContainerProps {
  lat: number;
  lng: number;
  className?: string;
}

type BMapGLPoint = object;
type BMapGLControl = object;
type BMapGLMapType = unknown;

interface BMapGLMap {
  centerAndZoom(point: BMapGLPoint, zoom: number): void;
  enableScrollWheelZoom(enabled: boolean): void;
  setDisplayOptions?: (options: {
    building?: boolean;
    indoor?: boolean;
    poi?: boolean;
    poiText?: boolean;
    poiIcon?: boolean;
    street?: boolean;
    skyColors?: string[];
  }) => void;
  setTilt(tilt: number): void;
  setHeading(heading: number): void;
  addControl(control: BMapGLControl): void;
  addOverlay(overlay: object): void;
  addEventListener(event: string, handler: () => void): void;
  setMapType(mapType: BMapGLMapType): void;
  panTo(point: BMapGLPoint): void;
  flyTo(point: BMapGLPoint, zoom: number): void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  destroy(): void;
}

interface BMapGLMarker {
  setPosition(point: BMapGLPoint): void;
}

interface BMapGLLabel {
  setStyle(style: Record<string, string>): void;
}

interface BMapGLNamespace {
  Map: new (element: HTMLElement) => BMapGLMap;
  Point: new (lng: number, lat: number) => BMapGLPoint;
  Size: new (width: number, height: number) => object;
  ZoomControl: new (options: { anchor: number; offset: object }) => BMapGLControl;
  Marker: new (point: BMapGLPoint) => BMapGLMarker;
  Label: new (text: string, options: { position: BMapGLPoint; offset: object }) => BMapGLLabel;
  BMAP_NORMAL_MAP: BMapGLMapType;
  BMAP_EARTH_MAP?: BMapGLMapType;
}

// 声明 BMapGL 类型 (使用 WebGL 版本)
declare global {
  interface Window {
    BMapGL?: BMapGLNamespace;
  }
}

/**
 * 3D 实时导航地图组件 (Powered by Baidu Map GL)
 * 
 * 修改说明：
 * 1. 移除了右上角的 GPS 信息悬浮窗，解决遮挡问题。
 * 2. 保留了核心的 3D 控制功能 (旋转、回正)。
 */
export const MapContainer: React.FC<MapContainerProps> = ({ lat, lng, className }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const initialLatRef = useRef(lat);
  const initialLngRef = useRef(lng);
  const mapInstance = useRef<BMapGLMap | null>(null);    // 保存地图实例
  const [error, setError] = useState<string | null>(() => (
      typeof window.BMapGL === 'undefined' ? "百度地图 GL API 未加载。" : null
  ));
  const [isFollowing, setIsFollowing] = useState<boolean>(true); // 是否锁定跟随车辆
  const [heading, setHeading] = useState<number>(0); // 地图旋转角度

  // 初始化地图
  useEffect(() => {
    if (!mapRef.current) return;

    if (!window.BMapGL) {
      return;
    }

    const initTimer = setTimeout(() => {
        try {
            if (!mapRef.current || !window.BMapGL) return;
            const BMapGL = window.BMapGL;
            const map = new BMapGL.Map(mapRef.current);
            const point = new BMapGL.Point(initialLngRef.current, initialLatRef.current);
            
            // 1. 基础配置
            map.centerAndZoom(point, 19); 
            map.enableScrollWheelZoom(true); 
            
            if (map.setDisplayOptions) {
                map.setDisplayOptions({
                    building: true,
                    indoor: true,
                    poi: true,
                    poiText: true,
                    poiIcon: true,
                    street: true,
                    skyColors: ['rgba(232, 241, 252, 1)', 'rgba(210, 225, 244, 1)']
                });
            }

            // 2. 设置 3D 视角
            map.setTilt(68);   
            map.setHeading(0); 
            setHeading(0);
            
            // 3. 事件监听
            map.addEventListener('dragstart', () => {
                setIsFollowing(false);
            });

            map.setMapType(window.BMapGL.BMAP_EARTH_MAP || window.BMapGL.BMAP_NORMAL_MAP); 

            mapInstance.current = map;
            setError(null);

        } catch (e) {
            console.error("Map Init Error:", e);
            setError("地图初始化异常");
        }
    }, 300); 
    
    return () => {
       clearTimeout(initTimer);
       if (mapInstance.current) {
           mapInstance.current.destroy();
       }
    };
  }, []); 

  // 监听坐标变化
  useEffect(() => {
    if (mapInstance.current && window.BMapGL) {
      const BMapGL = window.BMapGL;
      const newPoint = new BMapGL.Point(lng, lat);
      if (isFollowing) {
        mapInstance.current.panTo(newPoint);
      }
    }
  }, [lat, lng, isFollowing]);

  const handleRecenter = () => {
      const map = mapInstance.current;
      if (map && window.BMapGL) {
          const BMapGL = window.BMapGL;
          const point = new BMapGL.Point(lng, lat);
          map.flyTo(point, 19); 
          setTimeout(() => {
              map.setTilt(68);
              map.setHeading(0);
          }, 1000); 
          setIsFollowing(true);
          setHeading(0);
      }
  };

  const rotateMap = () => {
      if (mapInstance.current) {
          const newHeading = (heading + 90) % 360;
          mapInstance.current.setHeading(newHeading);
          setHeading(newHeading);
          setIsFollowing(false); 
      }
  };

  const handleZoomIn = () => {
      mapInstance.current?.zoomIn?.();
  };

  const handleZoomOut = () => {
      mapInstance.current?.zoomOut?.();
  };

  return (
    <div className={`relative bg-[#06101f] overflow-hidden flex flex-col ${className}`}>
        {/* 地图容器 */}
        <div className="absolute inset-0 bg-[#07111f] overflow-hidden">
            <div 
              ref={mapRef}
              className="w-full h-full min-h-[300px] brightness-[0.68] contrast-[1.12] saturate-[1.25] hue-rotate-[170deg] invert-[0.9]"
              id="baidu-map-container"
              style={{ backgroundColor: '#07111f' }} 
            />
        </div>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_64%,transparent_0,transparent_22%,rgba(3,7,18,0.18)_54%,rgba(3,7,18,0.52)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-[44%] pointer-events-none bg-gradient-to-b from-[#06101f]/90 via-[#06101f]/42 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none bg-gradient-to-t from-[#020817]/80 via-[#020817]/22 to-transparent" />

        {/* 错误提示 */}
        {error && (
            <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center text-center p-6 z-20">
                <Navigation size={48} className="text-red-500 mb-4" />
                <p className="text-gray-400 text-sm">{error}</p>
            </div>
        )}

        {!error && (
            <>
                <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
                    <span className="bg-slate-950/76 px-2.5 py-1.5 rounded-lg text-[10px] text-slate-200 border border-white/10 flex items-center gap-2 backdrop-blur-sm">
                        <Layers size={12} className="text-cyan-200" /> 
                        <span>3D 导航地图</span>
                    </span>
                </div>

                <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-20">
                    <div className="flex flex-col overflow-hidden rounded-lg border border-white/10 shadow-lg">
                        <button 
                            onClick={handleZoomIn}
                            className="bg-slate-950/82 hover:bg-slate-800 text-white w-9 h-9 flex items-center justify-center transition-all pointer-events-auto border-b border-white/10"
                            title="放大"
                        >
                            +
                        </button>
                        <button 
                            onClick={handleZoomOut}
                            className="bg-slate-950/82 hover:bg-slate-800 text-white w-9 h-9 flex items-center justify-center transition-all pointer-events-auto"
                            title="缩小"
                        >
                            -
                        </button>
                    </div>
                     <button 
                        onClick={rotateMap}
                        className="bg-slate-950/82 hover:bg-slate-800 text-white w-10 h-10 rounded-full shadow-lg border border-white/10 flex items-center justify-center transition-all pointer-events-auto"
                        title="旋转视角"
                    >
                        <Compass size={20} style={{ transform: `rotate(${heading}deg)`, transition: 'transform 0.5s' }} />
                    </button>

                    {!isFollowing && (
                        <button 
                            onClick={handleRecenter}
                            className="bg-cyan-500/90 hover:bg-cyan-400 text-slate-950 w-10 h-10 rounded-full shadow-lg border border-cyan-200 flex items-center justify-center transition-all animate-bounce pointer-events-auto"
                            title="回正视角"
                        >
                            <Locate size={20} />
                        </button>
                    )}
                </div>

                <div className="absolute left-4 bottom-14 z-20 pointer-events-none">
                    <span className="bg-slate-950/72 px-2.5 py-1.5 rounded-lg text-[10px] text-slate-300 border border-white/10 flex items-center gap-2 backdrop-blur-sm">
                        <MapPinned size={12} className="text-blue-200" />
                        <span>{isFollowing ? '已锁定车辆' : '拖动浏览中'}</span>
                    </span>
                </div>
            </>
        )}
    </div>
  );
};
