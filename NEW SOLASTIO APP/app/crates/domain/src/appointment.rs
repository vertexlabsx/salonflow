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
