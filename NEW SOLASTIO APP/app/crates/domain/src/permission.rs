pub fn has_permission(grants: &[String], permission: &str) -> bool {
    if permission.is_empty() {
        return true;
    }
    if grants
        .iter()
        .any(|grant| grant == "*" || grant == permission)
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
}
