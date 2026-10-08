import React from 'react';
import type { GpsTrackPoint } from '@workspace/shared';
import { canShowRouteMap } from '../../utils/routeMapSupport';
import RouteLine from './RouteLine';
import RouteTileMap from './RouteTileMap';

interface RouteMapProps {
  points: readonly GpsTrackPoint[];
  accessibilityLabel: string;
}

/**
 * A cardio session's route: over a real map where this build can draw one,
 * otherwise as a plain line.
 */
const RouteMap: React.FC<RouteMapProps> = (props) =>
  canShowRouteMap() ? <RouteTileMap {...props} /> : <RouteLine {...props} />;

export default RouteMap;
