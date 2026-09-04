pub fn has_permission(grants: &[String], permission: &str) -> bool {
    if permission.is_empty() {
        return true;
    }
    let aliases = legacy_aliases(permission);
    if grants
        .iter()
        .any(|grant| grant == "*" || grant == permission || aliases.contains(&grant.as_str()))
    {
        return true;
    }
    let Some((action, resource)) = permission.split_once(':') else {
        return false;
    };
    let admin_resource = format!("admin:{resource}");
    let action_wildcard = format!("{action}:*");
    grants
        .iter()
        .any(|grant| grant == "admin:*" || grant == &admin_resource || grant == &action_wildcard)
}

fn legacy_aliases(permission: &str) -> &'static [&'static str] {
    match permission {
        "read:appointments" => &["appointments.read", "appointments.manage"],
        "create:appointments" | "update:appointments" | "write:appointments" => &["appointments.manage"],
        "read:clients" => &["clients.read", "clients.manage"],
        "create:clients" | "update:clients" | "write:clients" => &["clients.manage"],
        "allow:staff-checkin-checkout" => &["attendance.manage"],
        "read:tasks" => &["tasks.read", "tasks.manage"],
        "write:tasks" | "update:tasks" => &["tasks.manage"],
        _ => &[],
    }
}

pub fn has_any_permission(grants: &[String], permissions: &[String]) -> bool {
    permissions
        .iter()
        .any(|permission| has_permission(grants, permission))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_existing_wildcard_semantics() {
        let grants = vec!["admin:*".to_string()];
        assert!(has_permission(&grants, "read:appointments"));
    }

    #[test]
    fn accepts_legacy_dot_style_permissions() {
        let grants = vec![
            "appointments.read".to_string(),
            "attendance.manage".to_string(),
        ];
        assert!(has_permission(&grants, "read:appointments"));
        assert!(has_permission(&grants, "allow:staff-checkin-checkout"));
    }
}
