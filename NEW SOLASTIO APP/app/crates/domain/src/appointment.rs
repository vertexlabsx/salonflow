use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppointmentStatus {
    Booked,
    Confirmed,
    Arrived,
    InService,
    Completed,
    Cancelled,
    NoShow,
}

impl AppointmentStatus {
    pub fn parse(value: &str) -> Option<Self> {
        use AppointmentStatus::*;
        match value {
            "booked" => Some(Booked),
            "confirmed" => Some(Confirmed),
            "arrived" => Some(Arrived),
            "in_service" => Some(InService),
            "completed" => Some(Completed),
            "cancelled" => Some(Cancelled),
            "no_show" => Some(NoShow),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        use AppointmentStatus::*;
        match self {
            Booked => "booked",
            Confirmed => "confirmed",
            Arrived => "arrived",
            InService => "in_service",
            Completed => "completed",
            Cancelled => "cancelled",
            NoShow => "no_show",
        }
    }

    pub fn can_transition_to(&self, next: &Self) -> bool {
        use AppointmentStatus::*;
        matches!(
            (self, next),
            (Booked, Confirmed | Arrived | Cancelled | NoShow)
                | (Confirmed, Arrived | Cancelled | NoShow)
                | (Arrived, InService | Completed | Cancelled)
                | (InService, Completed | Cancelled)
        ) || self == next
    }
}
