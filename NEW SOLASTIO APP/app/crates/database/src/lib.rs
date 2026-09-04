use mongodb::{options::ClientOptions, Client, Database};
use solastio_shared::{config::AppConfig, error::AppError};
use std::time::Duration;

pub mod models;
pub mod repositories;

#[derive(Clone)]
pub struct MongoStore {
    pub database: Database,
}

impl MongoStore {
    pub async fn connect(config: &AppConfig) -> Result<Self, AppError> {
        let mut options = ClientOptions::parse(&config.mongodb_uri)
            .await
            .map_err(|_| AppError::Database)?;
        options.max_pool_size = Some(config.mongodb_max_pool_size);
        let client = Client::with_options(options).map_err(|_| AppError::Database)?;
        Ok(Self {
            database: client.database(&config.mongodb_database),
        })
    }

    pub async fn ready(&self) -> bool {
        tokio::time::timeout(
            Duration::from_secs(2),
            self.database
                .run_command(mongodb::bson::doc! { "ping": 1 }, None),
        )
        .await
        .is_ok_and(|result| result.is_ok())
    }
}
