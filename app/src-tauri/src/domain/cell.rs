use crate::error::AppError;

pub(crate) const EDITOR_GRID_COLUMNS: i32 = 64;
pub(crate) const EDITOR_GRID_ROWS: i32 = 37;

pub(crate) fn parse_cell_id(value: &str) -> Result<(i32, i32), AppError> {
    let mut parts = value.trim().split(':');
    let x = parts
        .next()
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| AppError::invalid("A cell identifier must use x:y coordinates."))?;
    let y = parts
        .next()
        .and_then(|part| part.parse::<i32>().ok())
        .ok_or_else(|| AppError::invalid("A cell identifier must use x:y coordinates."))?;
    if parts.next().is_some()
        || !(0..EDITOR_GRID_COLUMNS).contains(&x)
        || !(0..EDITOR_GRID_ROWS).contains(&y)
    {
        return Err(AppError::invalid(
            "A cell identifier is outside the world grid.",
        ));
    }
    Ok((x, y))
}

pub(crate) fn cell_id(x: i32, y: i32) -> String {
    format!("{x}:{y}")
}

pub(crate) fn normalize_cell_ids(cell_ids: Vec<String>) -> Result<Vec<(i32, i32)>, AppError> {
    if cell_ids.is_empty() {
        return Err(AppError::invalid("At least one cell must be selected."));
    }
    if cell_ids.len() > 200_000 {
        return Err(AppError::invalid("The cell selection is too large."));
    }
    let mut cells = cell_ids
        .into_iter()
        .map(|id| parse_cell_id(&id))
        .collect::<Result<Vec<_>, _>>()?;
    cells.sort_unstable();
    cells.dedup();
    Ok(cells)
}

pub(crate) fn validate_cell_value(value: Option<&str>) -> Result<(), AppError> {
    if let Some(value) = value {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > 200 {
            return Err(AppError::invalid("A cell attribute value is invalid."));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_cell_id;

    #[test]
    fn accepts_only_active_editor_cell_ids() {
        assert_eq!(parse_cell_id("63:36").unwrap(), (63, 36));
        assert!(parse_cell_id("64:36").is_err());
        assert!(parse_cell_id("63:37").is_err());
    }
}
