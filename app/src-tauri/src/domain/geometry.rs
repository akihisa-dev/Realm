use crate::contract::FeatureType;
use crate::error::AppError;
use serde_json::Value;

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
