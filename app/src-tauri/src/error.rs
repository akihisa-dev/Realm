use rusqlite::{Error as SqlError, ErrorCode};
use serde::Serialize;
use std::sync::PoisonError;
use thiserror::Error;

#[derive(Debug, Error, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub(crate) fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
        }
    }
    pub(crate) fn invalid(message: &str) -> Self {
        Self::new("invalid_input", message)
    }
}

impl From<SqlError> for AppError {
    fn from(error: SqlError) -> Self {
        match error {
            SqlError::SqliteFailure(details, _) => match details.code {
                ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => Self::new(
                    "corrupt_project",
                    "The project file is corrupt or not a Realm project.",
                ),
                ErrorCode::ConstraintViolation => {
                    Self::new("storage_constraint", "The project could not be updated.")
                }
                _ => Self::new("storage_error", "The project could not be read or written."),
            },
            _ => Self::new("storage_error", "The project could not be read or written."),
        }
    }
}

impl<T> From<PoisonError<T>> for AppError {
    fn from(_: PoisonError<T>) -> Self {
        Self::new(
            "state_unavailable",
            "The project state is temporarily unavailable.",
        )
    }
}
