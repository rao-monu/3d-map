'use client'

import React from 'react'
import type { CesiumType } from '../types/cesium'
import { type Viewer } from 'cesium';
import type { Position } from '../types/position';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { debounce } from 'lodash';


export const CesiumComponent: React.FunctionComponent<{
    CesiumJs: CesiumType,
    positions: Position[]
}> = ({
    CesiumJs,
    positions
}) => {
    const cesiumViewer = React.useRef<Viewer | null>(null);
    const cesiumContainerRef = React.useRef<HTMLDivElement>(null);

    const initializeCesium = React.useCallback(async () => {
        if (cesiumContainerRef.current && !cesiumViewer.current) {
            CesiumJs.Ion.defaultAccessToken = `${process.env.NEXT_PUBLIC_CESIUM_TOKEN}`;

            cesiumViewer.current = new CesiumJs.Viewer(cesiumContainerRef.current, {
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                fullscreenButton: false,
                infoBox: false,
                selectionIndicator: false,
            });

            cesiumViewer.current.resolutionScale = 4.0;
            cesiumViewer.current.scene.globe.show = false;

            await add3DTiles();
            cesiumViewer.current.camera.moveEnd.addEventListener(debouncedUpdatePlaces);
            debouncedUpdatePlaces();
        }
    }, [CesiumJs]);        

    const add3DTiles = React.useCallback(async () => {
        if (cesiumViewer.current) {
            try {
                const tileset = await CesiumJs.Cesium3DTileset.fromIonAssetId(2275207, {
                    maximumScreenSpaceError: 8,
                });
                cesiumViewer.current.scene.primitives.add(tileset);
                // await cesiumViewer.current.zoomTo(tileset);
            } catch (error) {
                console.error("Error loading 3D Tiles:", error);
            }
        }
    }, [CesiumJs]);

    const getCurrentBoundingBox = React.useCallback(() => {
        if (cesiumViewer.current) {
            const camera = cesiumViewer.current.camera;
            const rectangle = camera.computeViewRectangle();
            if (rectangle) {
                return {
                    west: CesiumJs.Math.toDegrees(rectangle.west),
                    south: CesiumJs.Math.toDegrees(rectangle.south),
                    east: CesiumJs.Math.toDegrees(rectangle.east),
                    north: CesiumJs.Math.toDegrees(rectangle.north),
                };
            }
        }
        return null;
    }, [CesiumJs]);

    const isZoomAbove15 = React.useCallback(() => {
        if (cesiumViewer.current) {
            const cameraPosition = cesiumViewer.current.camera.position;
            const height = cesiumViewer.current.scene.globe.ellipsoid.cartesianToCartographic(cameraPosition).height;
            const zoomLevel = Math.floor(19 - Math.log2(height / 1000));
            return zoomLevel > 15;
        }
        return false;
    }, []);

    const fetchOverturePlaces = React.useCallback(async () => {
        if (!isZoomAbove15()) {
            return [];
        }

        const bbox = getCurrentBoundingBox();
        if (!bbox) return [];

        const apiUrl = `https://overture-places-api.vercel.app/api/download?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&output_format=geojson&type_=place&limit=100`;

        try {
            const response = await fetch(apiUrl);
            const data = await response.json();
            return data.features;
        } catch (error) {
            console.error("Error fetching Overture Maps data:", error);
            return [];
        }
    }, [getCurrentBoundingBox, isZoomAbove15]);

    const addPlaceLabels = React.useCallback(async (places: any[]) => {
        if (cesiumViewer.current) {
            cesiumViewer.current.entities.removeAll();

            const cartesians = places.map(place => {
                const [longitude, latitude] = place.geometry.coordinates;
                return CesiumJs.Cartesian3.fromDegrees(longitude, latitude);
            });

            try {
                const clampedCartesians = await cesiumViewer.current.scene.clampToHeightMostDetailed(cartesians);

                places.forEach((place, index) => {
                    const [longitude, latitude] = place.geometry.coordinates;
                    const clampedPosition = clampedCartesians[index];
                    const heightOffset = 20; // meters

                    const labelPosition = CesiumJs.Cartesian3.fromRadians(
                        CesiumJs.Math.toRadians(longitude),
                        CesiumJs.Math.toRadians(latitude),
                        CesiumJs.Cartographic.fromCartesian(clampedPosition).height + heightOffset
                    );

                    cesiumViewer.current!.entities.add({
                        position: labelPosition,
                        label: {
                            text: place.properties.names.primary,
                            font: "7px sans-serif",
                            style: CesiumJs.LabelStyle.FILL_AND_OUTLINE,
                            outlineWidth: 1,
                            fillColor: CesiumJs.Color.GREENYELLOW,
                            outlineColor: CesiumJs.Color.GREEN,
                            
                            horizontalOrigin: CesiumJs.HorizontalOrigin.CENTER,
                            verticalOrigin: CesiumJs.VerticalOrigin.TOP,
                            pixelOffset: new CesiumJs.Cartesian2(0, -10),
                            distanceDisplayCondition: new CesiumJs.DistanceDisplayCondition(0, 6000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                        point: {
                            pixelSize: 6,
                            color: CesiumJs.Color.WHITESMOKE,
                            outlineColor: CesiumJs.Color.ORANGERED,
                            outlineWidth: 2,
                            distanceDisplayCondition: new CesiumJs.DistanceDisplayCondition(0, 6000),
                            disableDepthTestDistance: Number.POSITIVE_INFINITY,
                        },
                        polyline: {
                            positions: [clampedPosition, labelPosition],
                            width: 0.2,
                            arcType: CesiumJs.ArcType.NONE,
                            material: CesiumJs.Color.BLACK,
                            distanceDisplayCondition: new CesiumJs.DistanceDisplayCondition(0, 1000),
                        }
                    });
                });
            } catch (error) {
                console.error("Error clamping positions to height:", error);            }
        }
    }, [CesiumJs]);
    const updatePlaces = React.useCallback(async () => {
        if (isZoomAbove15()) {
            const places = await fetchOverturePlaces();
            await addPlaceLabels(places);
        } else if (cesiumViewer.current) {
            cesiumViewer.current.entities.removeAll();
        }
    }, [isZoomAbove15, fetchOverturePlaces, addPlaceLabels]);

    const debouncedUpdatePlaces = React.useMemo(
        () => debounce(updatePlaces, 300),
        [updatePlaces]
    );

    React.useEffect(() => {
        initializeCesium();
        return () => {
            debouncedUpdatePlaces.cancel();
        };
    }, [initializeCesium, debouncedUpdatePlaces]);

    return (
        <div
            ref={cesiumContainerRef}
            id='cesiumContainer'
            style={{height: '100vh', width: '100vw'}}
        />
    )
}

export default CesiumComponent


