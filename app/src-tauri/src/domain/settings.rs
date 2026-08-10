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
    let allowed = [
        "themeId",
        "showGrid",
        "exportScale",
        "exportExtent",
        "canvasWidth",
        "canvasHeight",
        "gridKind",
        "gridColor",
        "gridWidth",
        "gridSpacing",
        "themeOverrides",
    ];
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
    for (key, label) in [
        ("canvasWidth", "canvasWidth"),
        ("canvasHeight", "canvasHeight"),
    ] {
        match object.get(key).and_then(Value::as_i64) {
            Some(value) if (512..=8192).contains(&value) => {}
            _ => {
                return Err(AppError::new(
                    "invalid_input",
                    &format!("Project settings {label} must be an integer between 512 and 8192."),
                ));
            }
        }
    }
    match object.get("gridKind") {
        Some(Value::String(value)) if matches!(value.as_str(), "graticule" | "square" | "hex") => {}
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings gridKind is invalid.",
            ));
        }
    }
    match object.get("gridColor") {
        Some(Value::String(value))
            if value.len() == 7
                && value.as_bytes()[0] == b'#'
                && value.as_bytes()[1..]
                    .iter()
                    .all(|byte| byte.is_ascii_hexdigit()) => {}
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings gridColor must be a #RRGGBB color.",
            ));
        }
    }
    for (key, label, minimum, maximum) in [
        ("gridWidth", "gridWidth", 0.25, 4.0),
        ("gridSpacing", "gridSpacing", 2.0, 45.0),
    ] {
        match object.get(key).and_then(Value::as_f64) {
            Some(value) if value.is_finite() && (minimum..=maximum).contains(&value) => {}
            _ => {
                return Err(AppError::new(
                    "invalid_input",
                    &format!("Project settings {label} is outside its allowed range."),
                ));
            }
        }
    }
    let overrides = match object.get("themeOverrides") {
        Some(Value::Object(value)) => value,
        _ => {
            return Err(AppError::new(
                "invalid_input",
                "Project settings themeOverrides must be an object.",
            ));
        }
    };
    const OVERRIDE_KEYS: [&str; 13] = [
        "canvas",
        "land",
        "landInk",
        "coastGlow",
        "river",
        "forest",
        "country",
        "region",
        "boundary",
        "settlement",
        "label",
        "labelHalo",
        "grid",
    ];
    if overrides.len() > OVERRIDE_KEYS.len()
        || overrides
            .keys()
            .any(|key| !OVERRIDE_KEYS.contains(&key.as_str()))
    {
        return Err(AppError::new(
            "invalid_input",
            "Project settings themeOverrides contain an unknown key or too many entries.",
        ));
    }
    if overrides.values().any(|value| {
        !matches!(
            value,
            Value::String(color)
                if color.len() == 7
                    && color.as_bytes()[0] == b'#'
                    && color.as_bytes()[1..]
                        .iter()
                        .all(|byte| byte.is_ascii_hexdigit())
        )
    }) {
        return Err(AppError::new(
            "invalid_input",
            "Project settings themeOverrides values must be #RRGGBB colors.",
        ));
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
