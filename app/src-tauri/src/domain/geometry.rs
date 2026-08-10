use crate::contract::FeatureType;
use crate::error::AppError;
use serde_json::Value;

pub(crate) const MAX_FEATURE_PROPERTIES_BYTES: usize = 32 * 1024;
/// Maximum number of positions retained by one persisted geometry. Polygon
/// rings are counted together, including their closing positions.
pub(crate) const MAX_COORDINATES: usize = 4_096;
/// Maximum UTF-8 encoded size of one persisted GeoJSON geometry.
pub(crate) const MAX_GEOMETRY_BYTES: usize = 512 * 1024;

const MIN_POLYGON_AREA: f64 = 1e-8;
const SEGMENT_EPSILON: f64 = 1e-12;

pub(crate) fn validate_name(name: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("A project name is required."));
    }
    if trimmed.chars().count() > 200 {
        return Err(AppError::invalid("The project name is too long."));
    }
    Ok(())
}

pub(crate) fn coordinate(value: &Value) -> Result<[f64; 2], AppError> {
    let values = value
        .as_array()
        .filter(|values| values.len() == 2)
        .ok_or_else(|| {
            AppError::invalid("Geometry coordinates must contain longitude and latitude.")
        })?;
    let longitude = values[0]
        .as_f64()
        .filter(|value| value.is_finite() && (-180.0..=180.0).contains(value))
        .ok_or_else(|| AppError::invalid("Geometry longitude must be between -180 and 180."))?;
    let latitude = values[1]
        .as_f64()
        .filter(|value| value.is_finite() && (-90.0..=90.0).contains(value))
        .ok_or_else(|| AppError::invalid("Geometry latitude must be between -90 and 90."))?;
    Ok([longitude, latitude])
}

pub(crate) fn line_coordinates(value: &Value, minimum: usize) -> Result<Vec<[f64; 2]>, AppError> {
    let values = value
        .as_array()
        .filter(|values| values.len() >= minimum)
        .ok_or_else(|| AppError::invalid("Geometry does not contain enough coordinates."))?;
    values.iter().map(coordinate).collect()
}

pub(crate) fn validate_geometry(
    feature_type: FeatureType,
    geometry: &Value,
) -> Result<String, AppError> {
    let object = geometry
        .as_object()
        .ok_or_else(|| AppError::invalid("Geometry must be a GeoJSON geometry object."))?;
    let geometry_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("Geometry type is required."))?;
    if geometry_type != feature_type.geometry_type() {
        return Err(AppError::invalid(
            "Geometry type does not match the selected feature class.",
        ));
    }
    let coordinates = object
        .get("coordinates")
        .ok_or_else(|| AppError::invalid("Geometry coordinates are required."))?;
    match geometry_type {
        "Point" => {
            coordinate(coordinates)?;
        }
        "LineString" => {
            line_coordinates(coordinates, 2)?;
        }
        "Polygon" => {
            let rings = coordinates
                .as_array()
                .filter(|rings| !rings.is_empty())
                .ok_or_else(|| AppError::invalid("A polygon must contain at least one ring."))?;
            for ring in rings {
                let points = line_coordinates(ring, 4)?;
                if points.first() != points.last() {
                    return Err(AppError::invalid("Polygon rings must be closed."));
                }
            }
        }
        _ => return Err(AppError::invalid("Unsupported GeoJSON geometry type.")),
    }
    serde_json::to_string(geometry)
        .map_err(|_| AppError::invalid("Geometry could not be encoded as GeoJSON."))
}

fn orientation(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn on_segment(a: [f64; 2], b: [f64; 2], point: [f64; 2]) -> bool {
    point[0] >= a[0].min(b[0])
        && point[0] <= a[0].max(b[0])
        && point[1] >= a[1].min(b[1])
        && point[1] <= a[1].max(b[1])
}

fn segments_intersect(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let first = orientation(a, b, c);
    let second = orientation(a, b, d);
    let third = orientation(c, d, a);
    let fourth = orientation(c, d, b);
    if ((first > SEGMENT_EPSILON && second < -SEGMENT_EPSILON)
        || (first < -SEGMENT_EPSILON && second > SEGMENT_EPSILON))
        && ((third > SEGMENT_EPSILON && fourth < -SEGMENT_EPSILON)
            || (third < -SEGMENT_EPSILON && fourth > SEGMENT_EPSILON))
    {
        return true;
    }
    (first.abs() <= SEGMENT_EPSILON && on_segment(a, b, c))
        || (second.abs() <= SEGMENT_EPSILON && on_segment(a, b, d))
        || (third.abs() <= SEGMENT_EPSILON && on_segment(c, d, a))
        || (fourth.abs() <= SEGMENT_EPSILON && on_segment(c, d, b))
}

fn point_in_ring(point: [f64; 2], ring: &[[f64; 2]]) -> bool {
    let mut inside = false;
    for segment in ring.windows(2) {
        let a = segment[0];
        let b = segment[1];
        if (a[1] > point[1]) != (b[1] > point[1])
            && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    inside
}

fn rings_intersect(first: &[[f64; 2]], second: &[[f64; 2]]) -> bool {
    first.windows(2).any(|first_segment| {
        second.windows(2).any(|second_segment| {
            segments_intersect(
                first_segment[0],
                first_segment[1],
                second_segment[0],
                second_segment[1],
            )
        })
    })
}

fn validate_polygon_ring_relationships(rings: &[Vec<[f64; 2]>]) -> Result<(), AppError> {
    let shell = &rings[0];
    for (index, hole) in rings.iter().enumerate().skip(1) {
        if rings_intersect(shell, hole) || !point_in_ring(hole[0], shell) {
            return Err(AppError::invalid(
                "Polygon holes must be strictly contained by the outer ring.",
            ));
        }
        for other in rings.iter().take(index).skip(1) {
            if rings_intersect(other, hole)
                || point_in_ring(hole[0], other)
                || point_in_ring(other[0], hole)
            {
                return Err(AppError::invalid(
                    "Polygon holes must not intersect or contain one another.",
                ));
            }
        }
    }
    Ok(())
}

fn strict_line_coordinates(
    value: &Value,
    minimum: usize,
    reject_closed: bool,
) -> Result<Vec<[f64; 2]>, AppError> {
    let values = value
        .as_array()
        .filter(|values| values.len() >= minimum && values.len() <= MAX_COORDINATES)
        .ok_or_else(|| AppError::invalid("Geometry contains too many or too few coordinates."))?;
    let points = values
        .iter()
        .map(coordinate)
        .collect::<Result<Vec<_>, _>>()?;
    if points.windows(2).enumerate().any(|(index, pair)| {
        pair[0] == pair[1] && !(index + 1 == points.len() - 1 && !reject_closed)
    }) {
        return Err(AppError::invalid(
            "LineString coordinates must not contain duplicate adjacent positions.",
        ));
    }
    if reject_closed && points.first() == points.last() {
        return Err(AppError::invalid(
            "LineString geometry must contain two distinct endpoints.",
        ));
    }
    Ok(points)
}

fn validate_ring_for_write(value: &Value) -> Result<Vec<[f64; 2]>, AppError> {
    let points = strict_line_coordinates(value, 4, false)?;
    if points.first() != points.last() {
        return Err(AppError::invalid("Polygon rings must be closed."));
    }

    // Match drawingGeometry.ts: adjacent segments and the closing pair share
    // endpoints by definition and are excluded from the self-intersection scan.
    let segment_count = points.len() - 1;
    for first in 0..segment_count {
        for second in (first + 1)..segment_count {
            if second == first + 1 || (first == 0 && second == segment_count - 1) {
                continue;
            }
            if segments_intersect(
                points[first],
                points[first + 1],
                points[second],
                points[second + 1],
            ) {
                return Err(AppError::invalid("Polygon rings must not self-intersect."));
            }
        }
    }

    let signed_area = points
        .windows(2)
        .map(|pair| pair[0][0] * pair[1][1] - pair[1][0] * pair[0][1])
        .sum::<f64>()
        / 2.0;
    if signed_area.abs() < MIN_POLYGON_AREA {
        return Err(AppError::invalid(
            "Polygon rings must have a non-zero minimum area.",
        ));
    }
    Ok(points)
}

/// Strict validation for newly created or revised features. The legacy
/// `validate_geometry` above intentionally remains permissive for read-model
/// validation so older v6 projects containing degenerate rows can still open.
pub(crate) fn validate_geometry_for_write(
    feature_type: FeatureType,
    geometry: &Value,
) -> Result<String, AppError> {
    let object = geometry
        .as_object()
        .ok_or_else(|| AppError::invalid("Geometry must be a GeoJSON geometry object."))?;
    let geometry_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid("Geometry type is required."))?;
    if geometry_type != feature_type.geometry_type() {
        return Err(AppError::invalid(
            "Geometry type does not match the selected feature class.",
        ));
    }
    let coordinates = object
        .get("coordinates")
        .ok_or_else(|| AppError::invalid("Geometry coordinates are required."))?;
    // Reject oversized objects before doing any potentially quadratic ring
    // intersection work.
    let encoded = serde_json::to_string(geometry)
        .map_err(|_| AppError::invalid("Geometry could not be encoded as GeoJSON."))?;
    if encoded.len() > MAX_GEOMETRY_BYTES {
        return Err(AppError::invalid("Geometry is too large."));
    }
    match geometry_type {
        "Point" => {
            coordinate(coordinates)?;
        }
        "LineString" => {
            strict_line_coordinates(coordinates, 2, true)?;
        }
        "Polygon" => {
            let rings = coordinates
                .as_array()
                .filter(|rings| !rings.is_empty())
                .ok_or_else(|| AppError::invalid("A polygon must contain at least one ring."))?;
            let total = rings.iter().try_fold(0usize, |total, ring| {
                total
                    .checked_add(ring.as_array().map_or(0, |values| values.len()))
                    .filter(|count| *count <= MAX_COORDINATES)
                    .ok_or_else(|| AppError::invalid("Geometry contains too many coordinates."))
            })?;
            if total == 0 {
                return Err(AppError::invalid(
                    "A polygon must contain at least one ring.",
                ));
            }
            let validated_rings = rings
                .iter()
                .map(validate_ring_for_write)
                .collect::<Result<Vec<_>, _>>()?;
            validate_polygon_ring_relationships(&validated_rings)?;
        }
        _ => return Err(AppError::invalid("Unsupported GeoJSON geometry type.")),
    }
    Ok(encoded)
}

pub(crate) fn validate_properties(properties: &Value) -> Result<String, AppError> {
    if !properties.is_object() {
        return Err(AppError::invalid("Feature properties must be an object."));
    }
    let encoded = serde_json::to_string(properties)
        .map_err(|_| AppError::invalid("Feature properties could not be encoded."))?;
    if encoded.len() > MAX_FEATURE_PROPERTIES_BYTES {
        return Err(AppError::invalid("Feature properties are too large."));
    }
    Ok(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn write_geometry_accepts_coordinate_limit_and_valid_holes() {
        let coordinates = (0..MAX_COORDINATES)
            .map(|index| {
                let longitude = -180.0 + (index as f64 * 360.0 / (MAX_COORDINATES - 1) as f64);
                json!([longitude, 0.0])
            })
            .collect::<Vec<_>>();
        let line = json!({"type": "LineString", "coordinates": coordinates});
        assert!(validate_geometry_for_write(FeatureType::River, &line).is_ok());

        let polygon = json!({
            "type": "Polygon",
            "coordinates": [
                [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                [[2.0, 2.0], [2.0, 4.0], [4.0, 4.0], [4.0, 2.0], [2.0, 2.0]]
            ]
        });
        assert!(validate_geometry_for_write(FeatureType::Country, &polygon).is_ok());
    }

    #[test]
    fn write_geometry_rejects_coordinate_and_byte_limits() {
        let coordinates = (0..=MAX_COORDINATES)
            .map(|index| json!([index as f64 % 180.0, 0.0]))
            .collect::<Vec<_>>();
        let line = json!({"type": "LineString", "coordinates": coordinates});
        assert!(validate_geometry_for_write(FeatureType::River, &line).is_err());

        let mut point = json!({"type": "Point", "coordinates": [0.0, 0.0]});
        point.as_object_mut().expect("object").insert(
            "padding".to_owned(),
            Value::String("x".repeat(MAX_GEOMETRY_BYTES)),
        );
        assert!(validate_geometry_for_write(FeatureType::City, &point).is_err());
    }

    #[test]
    fn write_geometry_rejects_degenerate_and_self_intersecting_rings() {
        let zero_area = json!({
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [1.0, 0.0], [1.0, 1e-10], [0.0, 0.0]]]
        });
        assert!(validate_geometry_for_write(FeatureType::Country, &zero_area).is_err());

        let self_intersecting = json!({
            "type": "Polygon",
            "coordinates": [[[0.0, 0.0], [10.0, 10.0], [0.0, 10.0], [10.0, 0.0], [0.0, 0.0]]]
        });
        assert!(validate_geometry_for_write(FeatureType::Country, &self_intersecting).is_err());
    }

    #[test]
    fn write_geometry_rejects_invalid_hole_relationships() {
        let outside = json!({
            "type": "Polygon",
            "coordinates": [
                [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                [[8.0, 8.0], [12.0, 8.0], [12.0, 12.0], [8.0, 8.0]]
            ]
        });
        assert!(validate_geometry_for_write(FeatureType::Country, &outside).is_err());

        let overlapping = json!({
            "type": "Polygon",
            "coordinates": [
                [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]],
                [[2.0, 2.0], [6.0, 2.0], [6.0, 6.0], [2.0, 2.0]],
                [[4.0, 3.0], [8.0, 3.0], [8.0, 7.0], [4.0, 3.0]]
            ]
        });
        assert!(validate_geometry_for_write(FeatureType::Country, &overlapping).is_err());
    }
}
