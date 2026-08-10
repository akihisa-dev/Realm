use crate::error::AppError;
use crate::storage::schema::{DEFAULT_SETTINGS_JSON, SETTINGS_MAX_BYTES};
use serde_json::Value;

pub(crate) fn default_settings() -> Value {
    serde_json::from_str(DEFAULT_SETTINGS_JSON).expect("default settings JSON is valid")
}

pub(crate) fn validate_settings(settings: &Value) -> Result<String, AppError> {
    let object = settings
        .as_object()
        .ok_or_else(|| AppError::new("invalid_input", "Project settings must be a JSON object."))?;
    let allowed = ["themeId", "showGrid", "exportScale", "exportExtent"];
    if object.len() != allowed.len() || object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(AppError::new(
            "invalid_input",
            "Project settings contain an unknown or missing key.",
        ));
    }
    match object.get("themeId") {
        Some(Value::String(value)) if matches!(value.as_str(), "ink" | "atlas" | "midnight") => {}
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings themeId is invalid.",
            ));
        }
    }
    if !matches!(object.get("showGrid"), Some(Value::Bool(_))) {
        return Err(AppError::new(
            "invalid_input",
            "Project settings showGrid must be a boolean.",
        ));
    }
    match object.get("exportScale") {
        Some(Value::Number(value)) if matches!(value.as_i64(), Some(1 | 2 | 4)) => {}
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings exportScale is invalid.",
            ));
        }
    }
    match object.get("exportExtent") {
        Some(Value::String(value)) if matches!(value.as_str(), "world" | "viewport") => {}
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings exportExtent is invalid.",
            ));
        }
    }
    let canonical = serde_json::to_string(settings)
        .map_err(|_| AppError::new("invalid_input", "Project settings could not be encoded."))?;
    if canonical.len() > SETTINGS_MAX_BYTES {
        return Err(AppError::new(
            "invalid_input",
            "Project settings are too large.",
        ));
    }
    Ok(canonical)
}

pub(crate) fn parse_stored_settings(value: &str) -> Result<Value, AppError> {
    let settings: Value = serde_json::from_str(value)
        .map_err(|_| AppError::new("corrupt_project", "Project settings are invalid."))?;
    validate_settings(&settings)
        .map_err(|_| AppError::new("corrupt_project", "Project settings are invalid."))?;
    Ok(settings)
}
